#!/usr/bin/env python3
"""Root-only, one-time minimal credential provisioning; never emits secrets."""
import json, os, pathlib, secrets, subprocess, urllib.parse

def run(args, data=None):
    result=subprocess.run(args,input=data,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError('ABSENT_PROVISION_COMMAND_FAILED')
    return result.stdout

def main():
    if os.geteuid()!=0: raise RuntimeError('ROOT_REQUIRED')
    path=pathlib.Path('/opt/suleia-secrets/absent-native-gate.env')
    if path.exists(): raise RuntimeError('EXISTING_SECRETS_MUST_NOT_BE_OVERWRITTEN')
    container=json.loads(run(['docker','inspect','suleia-operations-staging-ingestion-worker-1']))[0]
    existing=dict(item.split('=',1) for item in container['Config']['Env'])
    stores=json.loads(existing['DROPEA_STORES_CONFIG'])
    if len(stores)!=1 or stores[0]['market']!='ES': raise RuntimeError('SINGLE_ES_STORE_REQUIRED')
    reference=stores[0]['jwt_secret_reference']
    keys=['CHATBY_TOKEN','MIGRATION_HASH_KEY','DROPEA_STORES_CONFIG',reference]
    env={key:existing[key] for key in keys}
    password=secrets.token_hex(32)
    original=urllib.parse.urlsplit(existing['SHADOW_DATABASE_URL'])
    if original.hostname not in ['postgres','suleia-operations-staging-postgres-1']:
        raise RuntimeError('INTERNAL_DATABASE_REQUIRED')
    env['ABSENT_NATIVE_DATABASE_URL']=urllib.parse.urlunsplit((original.scheme,
        'suleia_absent_runtime:'+password+'@'+original.hostname+':'+str(original.port or 5432),original.path,original.query,''))
    env['ABSENT_NATIVE_GATE_TOKEN']=secrets.token_hex(32)
    env['PORT']='3310'
    if any('\n' in value or '\r' in value for value in env.values()): raise RuntimeError('INVALID_ENV_VALUE')
    sql="CREATE ROLE suleia_absent_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+password+"'; GRANT suleia_absent_controller TO suleia_absent_runtime;"
    run(['docker','exec','-i','suleia-operations-staging-postgres-1','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','suleia_admin','-d','suleia_staging'],sql)
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as file:
        file.write(''.join(key+'='+value+'\n' for key,value in env.items()))
    print('ABSENT_MINIMAL_SECRETS_PROVISIONED')

if __name__=='__main__':
    try: main()
    except Exception:
        print('ABSENT_SECRET_PROVISION_FAILED_NO_SECRET_OUTPUT')
        raise SystemExit(1)
