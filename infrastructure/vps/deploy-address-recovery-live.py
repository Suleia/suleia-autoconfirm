"""Guarded, source-only rollout; never edits the normal importer or its config."""
import fcntl, hashlib, json, os, pathlib, subprocess, sys, tarfile
from datetime import datetime, timezone

ROOT = pathlib.Path('/opt/suleia-address-import-recovery')
OLD = 'suleia-address-import-recovery-shadow'
UNIT = 'suleia-address-import-recovery'
NORMAL = pathlib.Path('/opt/suleia-shopify-dropea/current')
SYSTEMD = pathlib.Path('/etc/systemd/system')
run = lambda args: subprocess.check_output(args, stderr=subprocess.STDOUT, text=True).strip()
sha = lambda b: hashlib.sha256(b).hexdigest()

def dump(p, value):
    p.write_text(json.dumps(value, indent=2)); p.chmod(0o600)

def atomic(p, data, mode=0o644):
    tmp = p.with_name(p.name + '.address-recovery-stage')
    with open(tmp, 'xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    tmp.chmod(mode); os.replace(tmp, p)

def pointer(target):
    tmp = ROOT / 'current.address-recovery-stage'
    tmp.symlink_to(target); os.replace(tmp, ROOT / 'current')

def normal():
    files = [NORMAL/'autoconfirm/tools/recover-shopify-dropea.mjs',
             NORMAL/'autoconfirm/src/workflows/shopify-dropea-recovery.mjs',
             pathlib.Path('/etc/suleia/shopify-dropea-recovery.env'),
             SYSTEMD/'suleia-shopify-dropea-recovery.service', SYSTEMD/'suleia-shopify-dropea-recovery.timer']
    return {'release': str(NORMAL.resolve()), 'hashes': {str(p): sha(p.read_bytes()) for p in files},
            'enabled': run(['systemctl','is-enabled','suleia-shopify-dropea-recovery.timer'])}

def inventory():
    files = list(SYSTEMD.glob('suleia*')) + list(SYSTEMD.glob('recipient-absent*'))
    return {str(p): sha(p.read_bytes()) for p in files if p.is_file()}

def containers():
    return run(['docker','ps','--format','{{.Names}} {{.ID}}']).splitlines()

def stable(s, applied=False):
    assert normal() == s['normal'], 'NORMAL_IMPORTER_CHANGED'
    current = inventory()
    excluded = {str(SYSTEMD/(UNIT+'.service')), str(SYSTEMD/(UNIT+'.timer'))}
    assert all(current.get(p)==h for p,h in s['units'].items() if p not in excluded), 'UNRELATED_UNIT_CHANGED'
    assert containers()==s['containers'], 'UNRELATED_CONTAINER_CHANGED'
    assert str((ROOT/'current').resolve()) == (s['release'] if applied else s['previous']), 'RECOVERY_RELEASE_CHANGED'

def main():
    phase, manifest_path = sys.argv[1:3]
    m = json.loads(pathlib.Path(manifest_path).read_text())
    revision = m['revision']; assert len(revision)==40 and all(c in '0123456789abcdef' for c in revision)
    d = pathlib.Path('/var/lib/suleia-address-import-recovery-deploy')/revision
    release = ROOT/'releases'/revision
    if phase=='stage':
        assert not d.exists() and not release.exists(), 'STAGE_ALREADY_EXISTS_RECONCILE'
        assert str((ROOT/'current').resolve()) == m['expectedPrevious'], 'RECOVERY_BASE_CHANGED'
        assert run(['systemctl','show',OLD+'.service','-p','ActiveState','--value'])=='inactive', 'OBSERVER_BUSY'
        assert not (SYSTEMD/(UNIT+'.service')).exists() and not (SYSTEMD/(UNIT+'.timer')).exists(), 'LIVE_OWNER_ALREADY_EXISTS'
        archive=pathlib.Path(m['archive']); assert sha(archive.read_bytes())==m['archiveSha256'], 'ARCHIVE_MISMATCH'
        panel=json.loads(run(['docker','inspect','suleia-operations-staging-review-panel-1']))[0]
        panel_dir=next(pathlib.Path(x['Source']) for x in panel['Mounts'] if x['Destination']=='/usr/share/nginx/html')
        asset=panel_dir/'import-recovery.js'
        s={'revision':revision,'at':datetime.now(timezone.utc).isoformat(),'previous':str((ROOT/'current').resolve()),
           'release':str(release),'normal':normal(),'units':inventory(),'containers':containers(),
           'asset':str(asset),'assetBefore':sha(asset.read_bytes()),
           'observerEnabled':run(['systemctl','is-enabled',OLD+'.path'])}
        d.mkdir(parents=True,mode=0o700); (d/'asset.before').write_bytes(asset.read_bytes()); (d/'asset.before').chmod(0o600)
        release.mkdir(mode=0o755)
        with tarfile.open(archive) as tar:
            members=tar.getmembers()
            for f in members:
                assert (f.isfile() or f.isdir()) and (release/f.name).resolve().is_relative_to(release), 'UNSAFE_ARCHIVE_MEMBER'
            tar.extractall(release,filter='data')
        for p in [release,*release.rglob('*')]: p.chmod(0o755 if p.is_dir() else 0o644)
        s['files']={str(p.relative_to(release)):sha(p.read_bytes()) for p in (release/'services/import-recovery').glob('*.mjs')}
        dump(d/'state.private.json',s); stable(s)
        print(json.dumps({'staged':True,'revision':revision,'release':str(release),'normalImporterUnchanged':True}))
    else:
        s=json.loads((d/'state.private.json').read_text())
        if phase=='apply':
            stable(s); assert sha(pathlib.Path(s['asset']).read_bytes())==s['assetBefore'], 'PANEL_ASSET_CHANGED'
            for p,h in s['files'].items(): assert sha((release/p).read_bytes())==h, 'STAGED_SOURCE_CHANGED'
            run(['systemd-analyze','verify',str(release/'infrastructure/vps'/ (UNIT+'.service')),str(release/'infrastructure/vps'/(UNIT+'.timer'))])
            dump(d/'apply-intent.json',{'at':datetime.now(timezone.utc).isoformat(),'phase':'SOURCE_ONLY','shopifyWrite':True,'chatbySend':False,'dropeaImport':False})
            run(['systemctl','disable','--now',OLD+'.path'])
            assert run(['systemctl','show',OLD+'.service','-p','ActiveState','--value'])=='inactive', 'OBSERVER_BUSY'
            pointer(release)
            for suffix in ['service','timer']:
                atomic(SYSTEMD/(UNIT+'.'+suffix),(release/'infrastructure/vps'/(UNIT+'.'+suffix)).read_bytes())
            atomic(pathlib.Path(s['asset']),(release/'apps/review-panel/import-recovery.js').read_bytes())
            run(['systemctl','daemon-reload']); run(['systemctl','enable','--now',UNIT+'.timer'])
            stable(s,applied=True)
            dump(d/'apply.json',{'at':datetime.now(timezone.utc).isoformat(),'revision':revision,'normalImporterUnchanged':True,'unrelatedUnitsPreserved':True,'unrelatedContainersPreserved':True})
            run(['systemctl','start','--no-block',UNIT+'.service'])
            print(json.dumps({'applied':True,'revision':revision,'sourceOnly':True,'normalImporterUnchanged':True}))
        elif phase=='verify':
            stable(s,applied=True)
            assert run(['systemctl','is-enabled',UNIT+'.timer'])=='enabled'
            assert run(['systemctl','is-active',UNIT+'.timer'])=='active'
            assert run(['systemctl','show',OLD+'.path','-p','ActiveState','--value'])=='inactive'
            report=json.loads(pathlib.Path('/var/lib/suleia-address-import-recovery/overview.json').read_text())
            assert report['mode']=='LIVE' and report['coverageComplete'] is True and report['dropeaWrites']==0
            assert datetime.fromisoformat(report['completedAt'].replace('Z','+00:00')).timestamp() >= datetime.fromisoformat(json.loads((d/'apply-intent.json').read_text())['at']).timestamp()
            receipt={'at':datetime.now(timezone.utc).isoformat(),'revision':revision,'normalImporterUnchanged':True,'unrelatedUnitsPreserved':True,'unrelatedContainersPreserved':True,'mode':report['mode'],'coverageComplete':True,'metrics':report['metrics'],'shopifyWrites':report['shopifyWrites'],'directDropeaWrites':0}
            dump(d/'verified.json',receipt);print(json.dumps(receipt))
        elif phase=='rollback':
            assert str((ROOT/'current').resolve())==s['release'], 'RECOVERY_BASE_CHANGED'
            subprocess.run(['systemctl','disable','--now',UNIT+'.timer'],check=True)
            assert run(['systemctl','show',UNIT+'.service','-p','ActiveState','--value'])=='inactive', 'RECOVERY_IN_FLIGHT_RECONCILE_FIRST'
            pointer(s['previous']); atomic(pathlib.Path(s['asset']),(d/'asset.before').read_bytes())
            for suffix in ['service','timer']: (SYSTEMD/(UNIT+'.'+suffix)).unlink()
            run(['systemctl','daemon-reload']);run(['systemctl','enable','--now',OLD+'.path'])
            print(json.dumps({'rolledBack':True,'databaseClaimsAddressesPreserved':True}))
        else: raise ValueError('UNKNOWN_PHASE')

if __name__=='__main__':
    lock=open('/run/lock/suleia-address-recovery-deploy.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    main()
