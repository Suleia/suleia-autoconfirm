"""Bounded image patch. Preserve exact live config; keep old containers for rollback.

Usage: sudo python3 deploy-stabilization-patch.py REVISION PATCH_ROOT SERVICE
Only the three named read/projection services are accepted. No provider action.
"""
import sys,re,pathlib,subprocess,json,os,http.client,socket,time
revision,patch_root,service=sys.argv[1:]
assert re.fullmatch('[a-f0-9]{40}',revision)
files={
 'ingestion-worker':['services/integrations/render/address-signal.mjs','packages/platform-core/src/incident/address-canonical.mjs','services/incident-simulation-sync.mjs','packages/platform-core/src/incident/absent-resolution.mjs'],
 'api':['packages/suleia-operations-mcp/src/platform/catalog.mjs','packages/suleia-operations-mcp/src/security/pii.mjs'],
 'mcp-server':['packages/suleia-operations-mcp/src/platform/catalog.mjs','packages/suleia-operations-mcp/src/security/pii.mjs','packages/suleia-operations-mcp/src/mcp/server.mjs']}
assert service in files
name='suleia-operations-staging-'+service+'-1'
root=pathlib.Path(patch_root).resolve();assert str(root).startswith('/opt/suleia-deploy-checkpoints/stabilization-')
os.umask(0o077)
backup=root/('rollback-'+service);backup.mkdir(mode=0o700,exist_ok=True)
assert not (backup/'result.json').exists(), 'Already deployed; verify before repeating'
def run(args):
 p=subprocess.run(args,capture_output=True,text=True)
 if p.returncode:
  (backup/'command-error.txt').write_text(p.stderr)
  (backup/'command-output.txt').write_text(p.stdout)
  raise RuntimeError('COMMAND_FAILED: '+args[0])
 return p.stdout
original=json.loads(run(['docker','inspect',name]))[0]
if (backup/'container.json').exists():
 assert json.loads((backup/'container.json').read_text())['Id']==original['Id'], 'Live container changed since preparation'
(backup/'container.json').write_text(json.dumps(original))
image='suleia-stabilization-'+service+':'+revision
dockerfile=root/('Dockerfile.'+service)
base='suleia-stabilization-base:'+service+'-'+original['Image'].split(':')[-1][:12]
run(['docker','image','tag',original['Image'],base])
assert json.loads(run(['docker','image','inspect',base]))[0]['Id']==original['Image']
(root/'.dockerignore').write_text('rollback-*\n__pycache__\n')
dockerfile.write_text('FROM '+base+'\n'+
 '\n'.join('COPY '+f+' /app/'+f for f in files[service])+
 '\nLABEL io.suleia.stabilization.patch="'+revision+'"\n')
run(['docker','build','--network=none','-f',str(dockerfile),'-t',image,str(root)])
candidate=json.loads(run(['docker','image','inspect',image]))[0]
(backup/'image.json').write_text(json.dumps({'old':original['Image'],'new':candidate['Id'],'patch':revision}))
tests=(['services/integrations/render/address-signal.test.mjs','packages/platform-core/test/address-canonical.test.mjs','packages/platform-core/test/absent-resolution.test.mjs','services/recipient-absent-resolution-executor.test.mjs','services/shadow-worker-health.test.mjs','services/incident-simulation-sync.test.mjs']
 if service=='ingestion-worker' else ['packages/suleia-operations-mcp/test/stabilization-privacy.test.mjs','packages/suleia-operations-mcp/test/mcp-tools.test.mjs','packages/suleia-operations-mcp/test/security-controls.test.mjs'])
test_args=['docker','run','--rm','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=384m','--env','NODE_ENV=test']
for test in tests:test_args+=['--volume',str(root/test)+':/app/'+test+':ro']
test_args+=['--entrypoint','node',image,'--test','--test-reporter=tap',*tests]
(backup/'image-tests.tap').write_text(run(test_args))
class Docker(http.client.HTTPConnection):
 def __init__(self):super().__init__('localhost',timeout=60)
 def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.connect('/var/run/docker.sock')
def api(method,path,body=None):
 c=Docker();c.request(method,'/v1.47'+path,body=json.dumps(body) if body is not None else None,headers={'Content-Type':'application/json'})
 r=c.getresponse();data=r.read();c.close()
 if r.status>=400:
  (backup/'docker-error.txt').write_bytes(data);raise RuntimeError('DOCKER_API_HTTP_'+str(r.status))
 return json.loads(data) if data else {}
config=dict(original['Config']);config['Image']=image
config['Labels']={**config.get('Labels',{}),'io.suleia.stabilization.patch':revision}
config['HostConfig']=original['HostConfig']
config['NetworkingConfig']={'EndpointsConfig':{network:{'Aliases':[a for a in endpoint.get('Aliases',[]) if a not in [original['Id'],original['Id'][:12]]]} for network,endpoint in original['NetworkSettings']['Networks'].items()}}
old_name=name+'-rollback-'+revision[:8]
new_id=None;renamed=False
try:
 api('POST','/containers/'+original['Id']+'/stop?t=30')
 api('POST','/containers/'+original['Id']+'/rename?name='+old_name);renamed=True
 new_id=api('POST','/containers/create?name='+name,config)['Id']
 api('POST','/containers/'+new_id+'/start')
 after=json.loads(run(['docker','inspect',new_id]))[0]
 for field in ['Env','Cmd','Entrypoint','User','WorkingDir','Healthcheck']:
  assert original['Config'].get(field)==after['Config'].get(field),field
 for field in ['RestartPolicy','ReadonlyRootfs','Memory','NanoCpus','PidsLimit','PortBindings','Binds','CapDrop','SecurityOpt']:
  assert original['HostConfig'].get(field)==after['HostConfig'].get(field),field
 assert set(original['NetworkSettings']['Networks'])==set(after['NetworkSettings']['Networks'])
 assert after['State']['Running']
 (backup/'result.json').write_text(json.dumps({'service':service,'patch_commit':revision,'previous_container_id':original['Id'],'new_container_id':new_id,'image_id':candidate['Id'],'environment_preserved':True,'verified_at':time.time(),'functional_health':'PENDING'}))
 print(json.dumps({'service':service,'patch_commit':revision,'environment_preserved':True,'started':True,'functional_health':'PENDING','rollback_container':old_name}))
except BaseException:
 if new_id:
  try:api('POST','/containers/'+new_id+'/stop?t=15')
  except:pass
  api('DELETE','/containers/'+new_id)
 if renamed:api('POST','/containers/'+original['Id']+'/rename?name='+name)
 api('POST','/containers/'+original['Id']+'/start')
 raise
