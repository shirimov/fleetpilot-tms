#!/usr/bin/env bash
set -euo pipefail
# CI-only entry. Local development/authoring does not authorize this program.
[[ "${GITHUB_ACTIONS:-}" == true ]] || { printf '%s\n' CI_ONLY_REFUSED >&2; exit 1; }
# Only two fixed operations; never accept a state path or a cleanup command.
case "$#:${1:-}" in
  0:) mode=qualify; bound=1100s; grace=20s ;;
  1:--cleanup-only) mode=cleanup-only; bound=130s; grace=10s ;;
  *) printf '%s\n' FIXED_OPERATION_REFUSED >&2; exit 1 ;;
esac
exec timeout --signal=TERM --kill-after="$grace" "$bound" /usr/bin/python3 - "$mode" <<'PY'
import base64, hashlib, io, json, os, pathlib, re, selectors, signal, stat
import subprocess, sys, tarfile, time, uuid

BASE = 'e39173c13d8e23212a22b945dce15431d39cf214'
BRANCH = 'work/four-stream-qualification7-xbcif3_h'
EXPECTED_RUN_NUMBER = 2
GRANT_HASH = 'c6ae872a394ebda82b33ed5ee63d5626c0ce9956c89a101507db101c3883a6ec'
GRANT_BYTES = base64.b64decode('ewogICJyZWNvcmRlZEF0VVRDIjogIjIwMjYtMTEtMTRUMDE6NDY6MjMuNzY1MTMzKzAwOjAwIiwKICAib3JpZ2luIjogIlN1Ym1pdHRlZCBvd25lciBjbGFyaWZpY2F0aW9uIGZvcm0gaW4gdGhpcyBUZWxlZ3JhbSBjb252ZXJzYXRpb24iLAogICJvd25lclJlc3BvbnNlVmVyYmF0aW0iOiAiQXBwcm92ZSB1cCB0byB0aHJlZSBtb3JlIGN5Y2xlcyAoN1x1MjAxMzkpIiwKICAicXVlc3Rpb25TY29wZVZlcmJhdGltIjogIk1heSBJIG1ha2UgZGV2ZWxvcG1lbnQtb25seSBjb3JyZWN0aW9ucyB0byB0aGUgc2V2ZW4gcXVhbGlmaWNhdGlvbi10ZXN0L2hhcm5lc3MgZmlsZXMsIHdpdGggaW5kZXBlbmRlbnQgcmV2aWV3IGJlZm9yZSBlYWNoIGlzb2xhdGVkIENJIHJ1biwgZm9yIHVwIHRvIHRocmVlIGFkZGl0aW9uYWwgY3ljbGVzIChjdW11bGF0aXZlIG1heGltdW0gOSk/IFRoaXMgZXhjbHVkZXMgYXBwbGljYXRpb24gbG9naWMvcGVybWlzc2lvbiBjaGFuZ2VzLCB3ZWFrZW5lZCB0ZXN0cyBvciBpc29sYXRpb24sIHJlZnVzZWQtYWNjZXNzIHJldHJpZXMsIHJlYWwgZmluYW5jaWFsIGRhdGEsIG1lcmdlIGFuZCBkZXBsb3ltZW50LiBBbnkgc2VjdXJpdHkvYWNjZXNzIGZhaWx1cmUgc3RheXMgaGVsZC4iLAogICJwcmlvclVzZWQiOiA2LAogICJhbGxvd2VkQ3ljbGVzIjogWwogICAgNywKICAgIDgsCiAgICA5CiAgXSwKICAicmVzZXJ2ZWRDeWNsZSI6IDcsCiAgImF1dGhvcml6ZWRNYXhpbXVtIjogOSwKICAiYnVkZ2V0UmVzZXQiOiBmYWxzZSwKICAiY3ljbGUxMEF1dGhvcml6ZWQiOiBmYWxzZSwKICAiYmFzZSI6ICJlMzkxNzNjMTNkOGUyMzIxMmEyMmI5NDVkY2UxNTQzMWQzOWNmMjE0IiwKICAicXVhbGlmaWNhdGlvblJlbW90ZUJyYW5jaCI6ICJ3b3JrL2ZvdXItc3RyZWFtLXF1YWxpZmljYXRpb243LXhiY2lmM19oIiwKICAiZXhwZWN0ZWRXb3JrZmxvd0lkIjogNDE3ODk2NjExLAogICJleHBlY3RlZFdvcmtmbG93UnVuTnVtYmVyIjogMiwKICAiZXhwZWN0ZWRSdW5BdHRlbXB0IjogMSwKICAicHVibGljYXRpb25Pd25lciI6ICJQYXJlbnQgb25seSBhZnRlciBmcmVzaCB0YXJnZXQtYm91bmQgcmV2aWV3IFBBU1MgZm9yIGVhY2ggZXhhY3Qgc291cmNlIiwKICAic291cmNlU2NvcGUiOiAiT25seSBleGlzdGluZyBzZXZlbiBxdWFsaWZpY2F0aW9uIGFkZGl0aW9uczsgYWxsNjQ1IGFwcGxpY2F0aW9uIGJhc2VsaW5lIGZpbGVzIHVuY2hhbmdlZCIsCiAgIm11c3RIb2xkT25TZWN1cml0eU9yQWNjZXNzRmFpbHVyZSI6IHRydWUsCiAgImFwcGxpY2F0aW9uT3JQZXJtaXNzaW9uQ2hhbmdlc0F1dGhvcml6ZWQiOiBmYWxzZSwKICAid2Vha2VuZWRUZXN0c09ySXNvbGF0aW9uQXV0aG9yaXplZCI6IGZhbHNlLAogICJyZWZ1c2VkT3BlcmF0aW9uUmV0cnlPck5ld0FjY2Vzc0F1dGhvcml6ZWQiOiBmYWxzZSwKICAicHJpdmF0ZVJlYWxGaW5hbmNpYWxEYXRhQXV0aG9yaXplZCI6IGZhbHNlLAogICJtZXJnZU9yRGVwbG95bWVudEF1dGhvcml6ZWQiOiBmYWxzZSwKICAib3RoZXJDbGFyaWZpY2F0aW9uUmVzcG9uc2VzIjogewogICAgIm1hY0FjY2VzcyI6ICJ5b3UgbWVhbiB0aGUgd2Vic2l0ZT8gXHUyMDE0IGNsYXJpZmljYXRpb24sIE5PVCBjb25maXJtYXRpb24gb2YgU1NIIiwKICAgICJvcmlnaW5hbERhdGFBdmFpbGFiaWxpdHkiOiAieW91IG5lZWQgbW9yZSBzdGF0ZW1lbnRzIG9yIHdoYXQ/IFx1MjAxNCBjbGFyaWZpY2F0aW9uLCBOT1QgYSBuZXcgZXhwb3J0IG9yIGFic2VuY2UgcHJvb2YiCiAgfQp9Cg==')
ADDED = [
 'tests/disposable/playwright.config.ts', 'tests/disposable/assert-isolation.ts',
 'tests/disposable/Dockerfile', 'scripts/ci/disposable-acceptance.sh',
 '.github/workflows/validate-disposable-acceptance.yml',
 'tests/disposable/task-authenticated-acceptance.case.ts',
 'tests/disposable/fuel-authenticated-acceptance.case.ts',
]
CASES = {'tasks': ADDED[5], 'fuel': ADDED[6]}
start = time.monotonic()
phase_end = float('inf')
mode = sys.argv[1]
work_end = start + 970  # main 1100s +20s grace; external cleanup has its own budget
cleanup_end = start + (120 if mode=='cleanup-only' else 1080)
sequence = 0
sensitive_values = set()  # fresh synthetic values: memory only, never raw logs

def require(ok, code):
    if not ok: raise RuntimeError(code)

# Shared, inert admission precedes even cleanup. No fallback root, latest-state
# lookup, artifact download, provider environment or caller-selected path exists.
require(mode in ['qualify','cleanup-only'], 'FIXED_OPERATION_REFUSED')
require(hashlib.sha256(GRANT_BYTES).hexdigest()==GRANT_HASH, 'GRANT_BYTES')
grant=json.loads(GRANT_BYTES)
require(grant['reservedCycle']==7 and grant['authorizedMaximum']==9 and grant['priorUsed']==6 and
        grant['allowedCycles']==[7,8,9] and grant['budgetReset'] is False and grant['cycle10Authorized'] is False and
        grant['expectedWorkflowId']==417896611 and grant['expectedWorkflowRunNumber']==EXPECTED_RUN_NUMBER and
        grant['expectedRunAttempt']==1 and grant['mustHoldOnSecurityOrAccessFailure'] is True and
        all(grant[k] is False for k in ['applicationOrPermissionChangesAuthorized',
            'weakenedTestsOrIsolationAuthorized','refusedOperationRetryOrNewAccessAuthorized',
            'privateRealFinancialDataAuthorized','mergeOrDeploymentAuthorized']) and
        grant['base']==BASE and grant['qualificationRemoteBranch']==BRANCH, 'OWNER_ROUND')
require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_EVENT_NAME')=='push' and
        os.environ.get('GITHUB_REPOSITORY')=='shirimov/fleetpilot-tms' and
        os.environ.get('GITHUB_REPOSITORY_OWNER')=='shirimov' and
        os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH and
        os.environ.get('GITHUB_RUN_ATTEMPT')=='1' and os.environ.get('GITHUB_RUN_NUMBER')==str(EXPECTED_RUN_NUMBER),'CI_IDENTITY')
run_id=os.environ['GITHUB_RUN_ID']; sha=os.environ['GITHUB_SHA']
require(re.fullmatch('[1-9][0-9]{0,19}',run_id) is not None,'RUN_ID')
event=json.loads(pathlib.Path(os.environ['GITHUB_EVENT_PATH']).read_text())
require(re.fullmatch('[0-9a-f]{40}',sha) and event.get('after')==sha and
        event.get('before')=='0'*40 and event.get('created') is True and
        event.get('deleted') is False and event.get('forced') is False and
        event.get('ref')=='refs/heads/'+BRANCH and event['repository']['full_name']=='shirimov/fleetpilot-tms' and
        event['repository']['owner']['login']=='shirimov' and event['sender']['login']=='shirimov','EVENT_PIN')
base=pathlib.Path(os.environ['RUNNER_TEMP'])
require(base.is_absolute() and base.resolve()==base,'RUNNER_TEMP_PATH')
for path in [base,*base.parents]:
    st=path.lstat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid in [0,os.getuid()] and
            not st.st_mode & 0o022,'STATE_ANCESTRY')
root=base/('qualification7-'+run_id+'-1')
binding={'version':7,'round':7,'maximum':9,'priorUsed':6,'reservedCycle':7,'cycle10Authorized':False,'grantSha256':GRANT_HASH,
         'repository':'shirimov/fleetpilot-tms','owner':'shirimov','branch':BRANCH,
         'eventSha':sha,'runId':run_id,'attempt':1,'runNumber':EXPECTED_RUN_NUMBER}
if mode=='qualify':
    root.mkdir(mode=0o700)  # exclusive; never reuse an earlier attempt
    (root/'docker').mkdir(mode=0o700)
for path in [root,root/'docker']:
    st=path.lstat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid() and
            stat.S_IMODE(st.st_mode)==0o700,'STATE_DIRECTORY')
env={'PATH':'/usr/bin:/bin','HOME':str(root),'DOCKER_CONFIG':str(root/'docker'),
     'DOCKER_HOST':'unix:///var/run/docker.sock','LANG':'C.UTF-8'}

def save(name, data):
    # The independent process never overwrites the primary's raw receipt.
    # Its final authoritative overall status is external-receipt.json.
    if mode=='cleanup-only' and name=='receipt.json': name='external-receipt.json'
    # Atomic host-only replacement preserves the last full receipt if killed.
    path=root/name; temporary=root/(name+'.'+uuid.uuid4().hex+'.writing')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as out:
        out.write(json.dumps(data,indent=2)+'\n'); out.flush(); os.fsync(out.fileno())
    os.replace(temporary,path)

def load_private(name, limit):
    fd=os.open(root/name,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as inp:
        st=os.fstat(inp.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and
                stat.S_IMODE(st.st_mode)==0o600 and st.st_size<=limit,'STATE_FILE')
        return json.loads(inp.read(limit+1))

if mode=='qualify':
    nonce=uuid.uuid4().hex
    owned=[]
    receipt={**binding,'nonce':nonce,'status':'RUNNING','externalCleanup':'UNKNOWN',
             'tasks':'NOT_RUN','fuel':'NOT_RUN','cleanup':'UNKNOWN','commands':[]}
else:
    state=load_private('owned.json',100000)
    require(all(state.get(k)==v for k,v in binding.items()),'STATE_BINDING')
    nonce=state.get('nonce'); owned=state.get('resources')
    require(isinstance(nonce,str) and re.fullmatch('[0-9a-f]{32}',nonce) and
            isinstance(owned,list) and len(owned)<=5,'STATE_RESOURCES')
    try:
        receipt=load_private('receipt.json',1000000)
        require(all(receipt.get(k)==v for k,v in {**binding,'nonce':nonce}.items()),'RECEIPT_BINDING')
    except BaseException:
        # Never manufacture a primary PASS if interruption lost its receipt.
        receipt={**binding,'nonce':nonce,'status':'HOLD','failureCode':'PRIMARY_RECEIPT_UNKNOWN',
                 'tasks':'UNKNOWN','fuel':'UNKNOWN','cleanup':'UNKNOWN','commands':[],
                 'cleanupErrors':['PRIMARY_RECEIPT_UNKNOWN']}
    receipt['externalPriorStatus']=receipt.get('status','UNKNOWN')
    receipt['externalPriorCleanup']=receipt.get('cleanup','UNKNOWN')
    receipt['status']='HOLD'; receipt['externalCleanup']='UNKNOWN'
    receipt.setdefault('externalCommands',[])

def save_owned():
    save('owned.json',{**binding,'nonce':nonce,'resources':owned})

labels={'qualification7':nonce,'qualification.repository':binding['repository'],
        'qualification.eventSha':sha,'qualification.runId':run_id,'qualification.attempt':'1',
        'qualification.grant':GRANT_HASH,'qualification.round':'7','qualification.maximum':'9',
        'qualification.branch':BRANCH}
if mode=='qualify':
    save_owned(); save('receipt.json',receipt)

def run(argv, seconds=30, limit=2_000_000, check=True, cleanup=False):
    """Bound stream collection and the real child, including exceptional paths."""
    global sequence
    if mode=='cleanup-only':
        # A fixed cleanup-only capability, not an alternate operational entry.
        permitted=(argv==['git','rev-parse','HEAD'] or
                   argv==['git','show',sha+':scripts/ci/disposable-acceptance.sh'])
        if argv[0]=='docker':
            permitted=(argv[:3]==['docker','inspect','--format'] and len(argv)==5 and
                       argv[3]==CLEAN_INSPECT and any(argv[4] in [r.get('id'),r.get('name')] for r in owned) or
                       argv[:4]==['docker','rm','-f','-v'] and len(argv)==5 and any(argv[4]==r.get('id') for r in owned) or
                       argv==['docker','ps','-aq','--no-trunc','--filter','label=qualification7='+nonce] or
                       argv==['docker','volume','ls','-q','--filter','label=qualification7='+nonce])
        require(cleanup and permitted,'CLEANUP_OPERATION_REFUSED')
    sequence += 1
    number = sequence
    end = time.monotonic() + seconds
    if not cleanup: end = min(end, work_end, phase_end)
    else: end = min(end, cleanup_end)
    require(end > time.monotonic(), 'WORK_DEADLINE')
    path = root/(("external-" if mode=='cleanup-only' else '')+f'{number:03d}.log')
    buf = bytearray()
    proc = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    selector = selectors.DefaultSelector(); selector.register(proc.stdout, selectors.EVENT_READ)
    issue = None; code = None
    try:
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as log:
            while selector.get_map():
                if time.monotonic() >= end: issue = 'TIMEOUT'; break
                for key, _ in selector.select(min(0.2, max(0.0,end-time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk: selector.unregister(key.fileobj); continue
                    if len(buf)+len(chunk)>limit: issue = 'OUTPUT_LIMIT'; break
                    buf.extend(chunk)
                if issue: break
            if not issue:
                try: code = proc.wait(timeout=max(0.01,end-time.monotonic()))
                except subprocess.TimeoutExpired: issue = 'TIMEOUT'
    except BaseException:
        issue = issue or 'INTERRUPTED'
        raise
    finally:
        # The direct child has not been reaped when returncode is None. Keep
        # its identity owned until all group signals are complete.
        if proc.returncode is None:
            try: os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            time.sleep(0.1)
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            code = proc.wait(timeout=2)
        else: code=proc.returncode
        selector.close(); proc.stdout.close()
        redacted=bytes(buf)
        for value in sorted(sensitive_values,key=len,reverse=True):
            redacted=redacted.replace(value.encode(),b'[REDACTED_SYNTHETIC]')
        path.write_bytes(redacted); path.chmod(0o600)
        receipt['externalCommands' if mode=='cleanup-only' else 'commands'].append({'number':number,'executable':pathlib.Path(argv[0]).name,
                                    'exit':code,'issue':issue,'bytes':len(buf),
                                    'cleanupArgv':argv if cleanup else None})
        save('receipt.json',receipt)
    require(issue is None, issue or 'COLLECTOR')
    if check: require(code == 0, f'COMMAND_{number}_EXIT_{code}')
    return code, bytes(buf)

def docker(*args, **kw): return run(['docker',*args], **kw)
def obj(cid): return json.loads(docker('inspect',cid)[1])[0]
def census(expected):
    ids = docker('ps','-aq','--no-trunc')[1].decode().split()
    require(set(ids)==set(expected), 'FOREIGN_CONTAINER_OR_MISSING_OWNED')

def create(name, args):
    require(mode=='qualify','CLEANUP_ACQUISITION_REFUSED')
    # Journal before daemon acquisition; do not discard retired identities.
    kind=name.removeprefix('q7-').removesuffix('-'+nonce)
    require(kind in ['reader','tasks-db','tasks-app','fuel-db','fuel-app'],'RESOURCE_KIND')
    record={'kind':kind,'name':name,'id':None,'tmpfsVerified':None}
    owned.append(record); save_owned()
    label_args=[v for k,val in labels.items() for v in ['--label',k+'='+val]]
    raw=docker('create','--name',name,*label_args,*args)[1].decode().strip()
    require(re.fullmatch('[0-9a-f]{64}',raw) is not None,'CONTAINER_ID')
    record['id']=raw; save_owned()
    return raw

APP_TMP = {'/tmp':'rw,nosuid,nodev,size=512m,mode=1777',
           '/app/.next/cache':'rw,nosuid,nodev,size=64m,mode=1777',
           '/app/private-files':'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700'}
DB_TMP = {'/var/lib/postgresql/data':'rw,nosuid,nodev,noexec,size=512m,mode=1777',
          '/var/run/postgresql':'rw,nosuid,nodev,noexec,size=16m,mode=1777',
          '/tmp':'rw,nosuid,nodev,noexec,size=32m,mode=1777'}

def inspect_container(cid, image, network, user, tmp, memory, pids):
    data=obj(cid); host=data['HostConfig']; config=data['Config']
    require(data['Image']==image and config['User']==user,'IMAGE_OR_USER')
    require(host['NetworkMode']==network and not host['Privileged'] and host['ReadonlyRootfs'],'NETWORK_OR_ROOTFS')
    require(set(host.get('CapDrop') or [])=={'ALL'} and not host.get('CapAdd'),'CAPABILITIES')
    require(host.get('SecurityOpt')==['no-new-privileges'],'SECURITY_OPTIONS')
    require(not host.get('Binds') and not host.get('Devices') and not host.get('DeviceRequests') and
            not host.get('PortBindings') and not host.get('PublishAllPorts') and
            not host.get('ExtraHosts') and not host.get('Links') and
            not host.get('PidMode') and host.get('IpcMode')=='private','HOST_ACCESS')
    require(host.get('Tmpfs')==tmp and all(m['Type']=='tmpfs' for m in data.get('Mounts',[])),'MOUNTS')
    require(set(m['Destination'] for m in data.get('Mounts',[])) == set(tmp),'UNEXPECTED_VOLUME')
    require(host['Memory']==memory and host['PidsLimit']==pids and
            host['NanoCpus']==(1 if user=='postgres' else 2)*10**9,'RESOURCE_LIMITS')
    if user=='node':
        require(config['Entrypoint']==['/bin/sleep'] and config['Cmd']==['600'],'IDLE_APP_ENTRY')
    else:
        require(config['Cmd']==['postgres','-c','listen_addresses=127.0.0.1'],'DB_ENTRY')
    require(not any(re.search(r'(proxy|token|api_key|credential)',x.split('=')[0],re.I)
                    for x in config.get('Env',[])),'IMAGE_ENVIRONMENT')
    return data

def namespace_inode(pid):
    # A hosted runner UID may not ptrace/read another UID's /proc namespace
    # link. Existing sudo is used ONLY for trusted namespace inspection.
    raw=run(['sudo','-n','nsenter','-t',str(pid),'-n','--',
             'stat','-Lc','%i','/proc/self/ns/net'],limit=1000)[1].decode().strip()
    require(re.fullmatch('[0-9]+',raw) is not None,'NETNS_INODE_OUTPUT')
    return int(raw)

def verify_interfaces(pid):
    # Use only already installed trusted host tools; no policy/firewall changes.
    prefix=['sudo','-n','nsenter','-t',str(pid),'-n','--','ip','-j']
    addresses=json.loads(run(prefix+['address','show'])[1])
    require(len(addresses)==1 and addresses[0]['ifname']=='lo','EXTERNAL_INTERFACE')
    for family in ['-4','-6']:
        routes=json.loads(run(prefix+[family,'route','show','table','all'])[1])
        require(all(r.get('dev')=='lo' and r.get('dst') in
                    ['127.0.0.0/8','127.0.0.1','127.255.255.255','::1','::1/128'] for r in routes),'EXTERNAL_ROUTE')
    return addresses

def namespace(db, app):
    census([db,app])
    d=obj(db); a=obj(app)
    require(d['State']['Running'] and a['State']['Running'],'NOT_RUNNING')
    dp=d['State']['Pid']; ap=a['State']['Pid']
    di=namespace_inode(dp); ai=namespace_inode(ap)
    require(di==ai and di!=os.stat('/proc/self/ns/net').st_ino,'NETNS_INODE')
    addresses=verify_interfaces(dp)
    save('namespace-'+str(len(receipt.get('pairs',[])))+'.json',
         {'dbId':db,'appId':app,'dbPid':dp,'appPid':ap,'netInode':str(di),'addresses':addresses})
    return str(di)

# This projection deliberately excludes Config.Env and hence synthetic passwords.
CLEAN_INSPECT='{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Tmpfs":{{json .HostConfig.Tmpfs}}}'

def validate_owned():
    require(isinstance(owned,list) and len(owned)<=5,'OWNED_BOUND')
    names=set(); ids=set(); kinds=set()
    for rec in owned:
        kind=rec.get('kind')
        require(kind in ['reader','tasks-db','tasks-app','fuel-db','fuel-app'] and
                kind not in kinds and rec.get('name')=='q7-'+kind+'-'+nonce,'OWNED_NAME')
        kinds.add(kind)
        cid=rec.get('id')
        require(cid is None or isinstance(cid,str) and re.fullmatch('[0-9a-f]{64}',cid),'OWNED_ID_FORMAT')
        require(rec['name'] not in names and (cid is None or cid not in ids),'OWNED_DUPLICATE')
        names.add(rec['name'])
        if cid: ids.add(cid)
        expected=DB_TMP if kind.endswith('-db') else APP_TMP
        require(rec.get('tmpfsVerified') in [None,expected],'OWNED_MOUNT_RECORD')

def cleanup_inspect(target):
    code,raw=docker('inspect','--format',CLEAN_INSPECT,target,seconds=8,check=False,cleanup=True)
    if code:
        require(code==1 and b'No such object' in raw,'CLEANUP_INSPECT_UNKNOWN')
        return None
    return json.loads(raw)

def remove_owned():
    failures=[]; removals=[]
    try: validate_owned()
    except BaseException as error:
        failures.append(str(error)[:100])
    if not failures:
        for rec in reversed(owned):
            try:
                expected=DB_TMP if rec['kind'].endswith('-db') else APP_TMP
                data=cleanup_inspect(rec['id'] or rec['name'])
                if data is None:
                    # A pending create with no returned ID can still be in the
                    # daemon. Absence by name alone cannot settle that race.
                    require(rec['id'] is not None,'UNCERTAIN_CREATE_NO_ID')
                    require(cleanup_inspect(rec['name']) is None,'CLEANUP_NAME_REUSED')
                    require(rec['tmpfsVerified']==expected,'TMPFS_HISTORY_UNKNOWN')
                else:
                    require(data['Name']=='/'+rec['name'] and
                            all(data.get('Labels',{}).get(k)==v for k,v in labels.items()),'CLEANUP_OWNERSHIP')
                    cid=data['Id']
                    require(re.fullmatch('[0-9a-f]{64}',cid) and rec['id'] in [None,cid],'CLEANUP_ID')
                    mounts=data.get('Mounts',[])
                    require(data.get('Tmpfs')==expected and
                            all(m['Type']=='tmpfs' for m in mounts) and
                            {m['Destination'] for m in mounts}==set(expected),'OWNED_VOLUME_OR_TMPFS_UNKNOWN')
                    # Persist the actual pre-removal tmpfs census before rm, so
                    # an interrupted rm can be independently reconciled later.
                    rec['id']=cid; rec['tmpfsVerified']=expected; save_owned()
                    docker('rm','-f','-v',cid,seconds=8,cleanup=True)
                    require(cleanup_inspect(cid) is None,'REMOVAL_UNKNOWN')
                    require(cleanup_inspect(rec['name']) is None,'CLEANUP_NAME_REUSED')
                removals.append({'id':rec['id'],'name':rec['name'],'absenceVerified':True,
                                 'tmpfsDestinations':sorted(expected),'ownedVolumes':[]})
            except BaseException as error:
                failures.append(str(error)[:100] if type(error) is RuntimeError else type(error).__name__)
    try:
        require(not docker('ps','-aq','--no-trunc','--filter',f'label=qualification7={nonce}',
                           seconds=8,cleanup=True)[1].strip(),'OWNED_CONTAINER_REMAINS')
        require(not docker('volume','ls','-q','--filter',f'label=qualification7={nonce}',
                           seconds=8,cleanup=True)[1].strip(),'OWNED_VOLUME_REMAINS')
    except BaseException as error:
        failures.append(str(error)[:100] if type(error) is RuntimeError else type(error).__name__)
    removed_ids={r['id'] for r in removals if r['absenceVerified']}
    for pair in receipt.get('pairs',[]):
        if not failures and {pair['appId'],pair['dbId']} <= removed_ids:
            pair['wholePairCleanup']='VERIFIED_REMOVED_EXACT_IDS_AND_TMPFS'
            if pair['case']=='fuel': pair['perRowCleanup']='NOT_DELETED_INDIVIDUALLY_PAIR_DESTROYED'
    observation={'mode':mode,'errors':failures,'ownedIds':[r.get('id') for r in owned],
                 'removals':removals,'labels':labels,'exactVolumeCensusEmpty':not failures}
    receipt.setdefault('cleanupHistory',[]).append(observation)
    receipt.setdefault('cleanupErrors',[]).extend(failures)
    receipt['cleanup']='UNKNOWN' if receipt['cleanupErrors'] else 'VERIFIED'
    if mode=='cleanup-only':
        receipt['externalCleanup']='UNKNOWN' if failures else 'VERIFIED_EXACT_ABSENCE_AND_TMPFS'
        save('external-cleanup.json',{**binding,'nonce':nonce,**observation})
    save('receipt.json',receipt)
    return not receipt['cleanupErrors']

def stop_signal(signum, frame): raise RuntimeError('SIGNAL_STOP')
signal.signal(signal.SIGTERM,stop_signal); signal.signal(signal.SIGINT,stop_signal)

if mode=='cleanup-only':
    # Independent process, reached on workflow always(), never the qualification
    # path below. It does not acquire/build/start/migrate/execute a container.
    try:
        save('receipt-before-external.json',receipt)
        validate_owned()
        require(run(['git','rev-parse','HEAD'],seconds=5,cleanup=True)[1].decode().strip()==sha,'CLEANUP_CHECKOUT_SHA')
        source=run(['git','show',sha+':scripts/ci/disposable-acceptance.sh'],seconds=5,cleanup=True)[1]
        require(source==pathlib.Path('scripts/ci/disposable-acceptance.sh').read_bytes(),'CLEANUP_SOURCE_BYTES')
        clean=remove_owned()
        eligible=(clean and receipt.get('mainStatus')=='PASS' and
                  receipt.get('externalPriorStatus')=='PENDING_EXTERNAL_CLEANUP' and
                  receipt.get('externalPriorCleanup')=='VERIFIED' and
                  all(receipt.get(c)=='PASS' for c in CASES))
        receipt['status']='PASS' if eligible else 'HOLD'
        for case in CASES:
            if receipt.get(case)=='RUNNING': receipt[case]='FAIL_OR_UNKNOWN'
        if receipt['status']=='HOLD' and 'failureCode' not in receipt:
            receipt['failureCode']='PRIMARY_INCOMPLETE_OR_INTERRUPTED'
    except BaseException as error:
        receipt['status']='HOLD'; receipt['externalCleanup']='UNKNOWN'
        receipt.setdefault('externalErrors',[]).append(str(error)[:100] if type(error) is RuntimeError else type(error).__name__)
        save('external-cleanup.json',{**binding,'nonce':nonce,'status':'UNKNOWN',
                                    'errors':receipt['externalErrors']})
    save('receipt.json',receipt)
    print(json.dumps({'status':receipt['status'],'externalCleanup':receipt.get('externalCleanup','UNKNOWN')}),flush=True)
    sys.exit(0 if receipt['status']=='PASS' and receipt.get('externalCleanup')=='VERIFIED_EXACT_ABSENCE_AND_TMPFS' else 1)

try:
    require(run(['git','rev-parse','HEAD'])[1].decode().strip()==sha,'CHECKOUT_SHA')
    require(not run(['git','status','--porcelain','--untracked-files=all'])[1].strip(),'DIRTY_CHECKOUT')
    baseline=run(['git','ls-tree','-r','--name-only',BASE])[1].decode().splitlines()
    require(len(baseline)==645,'BASELINE_645')
    require(not run(['git','diff',BASE,sha,'--',*baseline])[1],'BASELINE_CHANGED')
    changed=run(['git','diff','--name-status',BASE,sha])[1].decode().splitlines()
    require(sorted(changed)==sorted('A\t'+x for x in ADDED),'EXACT_SEVEN_SOURCE_PATHS')
    receipt.update({'eventSha':sha,'runId':run_id,'attempt':1,'runNumber':EXPECTED_RUN_NUMBER,'branch':BRANCH})
    save('owner-grant.json',grant)
    census([])
    run(['sudo','-n','nsenter','--version'])
    run(['ip','-Version'])
    members=[]
    all_paths=run(['git','ls-tree','-r','--name-only',sha])[1].decode().splitlines()
    def build_member(name):
        parts=pathlib.PurePosixPath(name).parts
        if any(part.startswith('.env') or part in ['.git','node_modules','.next'] for part in parts): return False
        allowed=(parts[0] in ['src','prisma','tests','scripts'] or name in ADDED or
                 name in ['package.json','package-lock.json','tsconfig.json','next.config.ts',
                          'postcss.config.mjs','eslint.config.mjs','prisma.config.ts','playwright.config.ts'])
        # No public business documents, uploaded inputs or statistics snapshots.
        return allowed or (parts[0]=='public' and len(parts)==2 and
                           (name.endswith(('.svg','.png')) or name=='public/manifest.json'))
    selected_paths=[name for name in all_paths if build_member(name)]
    # Select before reading archive bytes, excluding business/env inputs entirely.
    archive=run(['git','archive','--format=tar',sha,'--',*selected_paths],limit=40_000_000)[1]
    context=root/'context'; context.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        for item in tf.getmembers():
            name=item.name
            require(not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts,'ARCHIVE_PATH')
            if item.isdir(): continue
            require(item.isfile() and name in selected_paths,'ARCHIVE_NONREGULAR_OR_UNSELECTED')
            data=tf.extractfile(item).read()
            target=context/name; target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(data); target.chmod(item.mode)
            members.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'mode':item.mode})
    require(set(selected_paths)==set(m['path'] for m in members),'ARCHIVE_MEMBERSHIP')
    require(set(ADDED) <= set(m['path'] for m in members),'SEVEN_BUILD_MEMBERS')
    receipt['sourceMembers']=[m for m in members if m['path'] in ADDED]
    receipt['sourceCommit']=sha
    save('source-members.json',members)
    # Pull only in online acquisition. Pin digest AND actual local config IDs.
    images={}
    for key,tag in [('node','node:20-bookworm-slim'),('postgres','postgres:17.5-alpine')]:
        docker('pull',tag,seconds=150)
        info=json.loads(docker('image','inspect',tag)[1])[0]
        require(info['RepoDigests'] and re.fullmatch('sha256:[0-9a-f]{64}',info['Id']),'IMAGE_DIGEST')
        images[key]={'digest':info['RepoDigests'][0],'id':info['Id']}
    save('images.json',images)
    iid=root/'image-id'
    docker('build','--pull=false','--network=default','--build-arg','NODE_IMAGE='+images['node']['digest'],
           '--build-arg','APP_COMMIT_SHA='+sha,'--iidfile',str(iid),
           '-f',str(context/'tests/disposable/Dockerfile'),str(context),seconds=660,limit=8_000_000)
    image=iid.read_text().strip(); require(re.fullmatch('sha256:[0-9a-f]{64}',image),'BUILT_IMAGE_ID')
    images['acceptance']={'id':image}; save('images.json',images)
    common=['--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--ipc','private','--log-driver','local','--log-opt','max-size=2m','--log-opt','max-file=1']
    def tmp_args(mapping): return [x for k,v in mapping.items() for x in ['--tmpfs',k+':'+v]]
    basic={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','TMPDIR':'/tmp','NODE_ENV':'production',
           'CI':'1','NEXT_TELEMETRY_DISABLED':'1','PLAYWRIGHT_BROWSERS_PATH':'/opt/playwright',
           'APP_COMMIT_SHA':sha,'PLAYWRIGHT':'1','PRIVATE_FILE_STORAGE_ROOT':'/app/private-files'}
    def execute(cid, settings, argv, **kw):
        return docker('exec',cid,'/usr/bin/env','-i',*[k+'='+v for k,v in settings.items()],*argv,**kw)
    reader=create('q7-reader-'+nonce,common+['--network','none','--user','node','--memory','3g',
                  '--cpus','2','--pids-limit','384',*tmp_args(APP_TMP),'--entrypoint','/bin/sleep',image,'600'])
    inspect_container(reader,image,'none','node',APP_TMP,3*1024**3,384)
    docker('start',reader); census([reader])
    reader_data=obj(reader); reader_pid=reader_data['State']['Pid']
    require(reader_data['State']['Running'] and
            namespace_inode(reader_pid)!=os.stat('/proc/self/ns/net').st_ino,'READER_NETNS')
    save('reader-namespace.json',{'containerId':reader,'pid':reader_pid,
         'addresses':verify_interfaces(reader_pid)})
    # Inert image hash/browser census; no candidate imports and NO DB acquired.
    reader_js="""const fs=require('fs'),c=require('crypto');const m=JSON.parse(fs.readFileSync('/tmp/members.json'));
for(const x of m){if(c.createHash('sha256').update(fs.readFileSync('/app/'+x.path)).digest('hex')!==x.sha256)process.exit(9)}
const files=[];function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const q=p+'/'+d.name;if(d.isDirectory())walk(q);else if(d.isFile()&&(d.name==='chrome'||d.name==='headless_shell'))files.push({path:q,sha256:c.createHash('sha256').update(fs.readFileSync(q)).digest('hex')})}}walk('/opt/playwright');if(!files.length)process.exit(8);console.log(JSON.stringify(files));"""
    # Build can emit public/sw.js: pin original source only, not generated output.
    memberpath=root/'members.json'; memberpath.write_text(json.dumps(members)); memberpath.chmod(0o444)
    docker('cp',str(memberpath),reader+':/tmp/members.json')
    execute(reader,basic,['node','-e',reader_js],seconds=60)
    ordinary=dict(basic,TEST_COMPANY_ID='synthetic-list-company',TEST_OWNER_ID='synthetic-list-owner')
    _,listing=execute(reader,ordinary,['node','node_modules/playwright/cli.js','test','--list'],seconds=60)
    text=listing.decode(); require('.case.ts' not in text and 'disposable/' not in text,'DEFAULT_DISCOVERY_LEAK')
    specfiles=list((context/'tests/ui').glob('*.spec.ts'))
    expected=sum(len(re.findall(r'\btest\s*\(',f.read_text())) for f in specfiles)
    footer=re.search(r'Total: (\d+) tests? in (\d+) files?',text)
    entries=[line for line in text.splitlines() if re.search(r'\.spec\.ts:\d+:\d+\s+›',line)]
    require(footer and int(footer[1])==expected==len(entries) and int(footer[2])==len(specfiles),'DEFAULT_LIST_COUNTS')
    receipt['defaultDiscovery']={'tests':expected,'files':len(specfiles),'casePathsExcluded':True}
    # Negative probes execute only here, in the ONE approved isolated CI reader.
    probes=[['node','--import','tsx','-e',
      "const {assertDisposableIsolation:g}=require('./tests/disposable/assert-isolation.ts'); try{g('tasks');process.exit(9)}catch(e){if(e.message!=='DISPOSABLE_ISOLATION_REFUSED')throw e}"],
      ['node','node_modules/playwright/cli.js','test','--config=tests/disposable/playwright.config.ts','--list']]
    execute(reader,basic,probes[0],seconds=30)
    malformed=dict(basic,DISPOSABLE_CASE='tasks',EMAIL_AUTH_ENABLED='true',TELEGRAM_ENABLED='false',
       AUTH_TRUST_HOST='true',AUTH_URL='http://127.0.0.1:3100',AUTH_SECRET='0'*64,
       DATABASE_URL='postgresql://acceptance:'+'0'*48+'@127.0.0.1:5432/acceptance?schema=public')
    for label,overrides,selected in [
        ('wrong-case',{'DISPOSABLE_CASE':'fuel'},'tasks'),
        ('unknown-case',{},'unknown'),
        ('provider-key',{'TELEGRAM_BOT_TOKEN':'synthetic-denied'},'tasks'),
        ('nonloopback-db',{'DATABASE_URL':'postgresql://acceptance:synthetic@example.test/acceptance'},'tasks'),
        ('missing-host-proof',{},'tasks'),
    ]:
        statement="const {assertDisposableIsolation:g}=require('./tests/disposable/assert-isolation.ts');try{g("+json.dumps(selected)+");process.exit(9)}catch(e){if(e.message!=='DISPOSABLE_ISOLATION_REFUSED')throw e}"
        execute(reader,dict(malformed,**overrides),['node','--import','tsx','-e',statement],seconds=30)
        receipt.setdefault('denialProbes',[]).append(label)
    code,out=execute(reader,basic,probes[1],seconds=30,check=False)
    require(code!=0 and b'DISPOSABLE_CASE_REFUSED' in out,'CONFIG_DENIAL')
    for case,path in CASES.items():
        code,out=execute(reader,dict(basic,DISPOSABLE_CASE=case),
            ['node','--import','tsx',path],seconds=30,check=False)
        require(code!=0 and b'DISPOSABLE_ISOLATION_REFUSED' in out,'CASE_EARLY_DENIAL')
    require(remove_owned(),'READER_CLEANUP')
    receipt['pairs']=[]
    for case,path in CASES.items():
        pair_end=min(work_end,time.monotonic()+600)
        phase_end=pair_end
        require(work_end-time.monotonic()>=320,'INSUFFICIENT_PAIR_TIME')
        password=uuid.uuid4().hex+uuid.uuid4().hex[:16]
        secret=uuid.uuid4().hex+uuid.uuid4().hex
        url='postgresql://acceptance:'+password+'@127.0.0.1:5432/acceptance?schema=public'
        sensitive_values.update([password,secret,url])
        db=create('q7-'+case+'-db-'+nonce,common+['--network','none','--user','postgres','--memory','768m',
           '--cpus','1','--pids-limit','128',*tmp_args(DB_TMP),
           '--env','PGDATA=/var/lib/postgresql/data/pgdata',
           '--env','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256','--env','POSTGRES_USER=acceptance',
           '--env','POSTGRES_DB=acceptance','--env','POSTGRES_PASSWORD='+password,
           images['postgres']['id'],'postgres','-c','listen_addresses=127.0.0.1'])
        app=create('q7-'+case+'-app-'+nonce,common+['--network','container:'+db,'--user','node',
           '--memory','3g','--cpus','2','--pids-limit','384',*tmp_args(APP_TMP),
           '--entrypoint','/bin/sleep',image,'600'])
        inspect_container(db,images['postgres']['id'],'none','postgres',DB_TMP,768*1024**2,128)
        inspect_container(app,image,'container:'+db,'node',APP_TMP,3*1024**3,384)
        docker('start',db); docker('start',app)
        inode=namespace(db,app)
        settings=dict(basic,DATABASE_URL=url,AUTH_SECRET=secret,AUTH_URL='http://127.0.0.1:3100',
          AUTH_TRUST_HOST='true',EMAIL_AUTH_ENABLED='true',TELEGRAM_ENABLED='false',DISPOSABLE_CASE=case)
        proof={'version':7,'round':7,'maximum':9,'priorUsed':6,'reservedCycle':7,'cycle10Authorized':False,'attempt':1,'runNumber':EXPECTED_RUN_NUMBER,'grantSha256':GRANT_HASH,
          'repository':'shirimov/fleetpilot-tms','branch':BRANCH,'case':case,'eventSha':sha,
          'runId':os.environ['GITHUB_RUN_ID'],'dbId':db,'appId':app,'appImage':image,
          'dbImage':images['postgres']['id'],'netInode':inode,'networkVerified':True,
          'expiresAt':int((time.time()+min(590,pair_end-time.monotonic()))*1000),
          'databaseUrlHash':hashlib.sha256(url.encode()).hexdigest(),
          'authSecretHash':hashlib.sha256(secret.encode()).hexdigest(),
          'members':[m for m in members if m['path'] in ADDED]}
        # The private root belongs to this exact app/test container's tmpfs.
        storage_js="""const fs=require('fs');for(const p of ['/','/app','/app/private-files']){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))process.exit(9);if(p==='/app/private-files'){if(s.uid!==1000||s.gid!==1000||(s.mode&0o777)!==0o700||fs.statfsSync(p).type!==0x1021994||fs.readdirSync(p).length)process.exit(8)}else if(s.uid!==0)process.exit(7)}console.log('PRIVATE_TMPFS_VERIFIED');"""
        execute(app,basic,['node','-e',storage_js],seconds=15)
        proof['storage']={'root':'/app/private-files','appId':app,'tmpfs':True,
                          'uid':1000,'gid':1000,'mode':'0700','trustedAncestry':True,
                          'freshEmptyVerified':True,'maxBytes':64*1024**2}
        def publish_proof():
            proofpath=root/(case+'-proof.json')
            proofpath.write_text(json.dumps(proof)); proofpath.chmod(0o444)
            docker('cp',str(proofpath),app+':/tmp/disposable-proof.json')
        # Fuel's complete guard is admitted only AFTER migrations and observer
        # provisioning. Migration itself has fixed env/argv and host isolation.
        if case=='tasks': publish_proof()
        # Startup wait is polling readiness, not retrying a failed test/migration.
        ready_end=min(pair_end,time.monotonic()+35)
        while True:
            code,_=docker('exec',db,'pg_isready','-h','127.0.0.1','-U','acceptance','-d','acceptance',check=False)
            if code==0: break
            require(time.monotonic()<ready_end,'POSTGRES_NOT_READY'); time.sleep(0.5)
        # Host-owned exact D namespace target identity, then guard before migration.
        if case=='tasks':
            execute(app,settings,['node','--import','tsx','-e',
                "const {assertDisposableIsolation:g}=require('./tests/disposable/assert-isolation.ts'); g(process.env.DISPOSABLE_CASE)"],seconds=20)
        namespace(db,app)
        execute(app,settings,['node','node_modules/prisma/build/index.js','migrate','deploy'],seconds=min(120,pair_end-time.monotonic()))
        identity="SELECT current_database(), current_user, inet_server_addr()::text, inet_server_port();"
        _,identity_out=docker('exec',db,'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin',
            'PGPASSWORD='+password,'psql','-h','127.0.0.1','-U','acceptance','-d','acceptance','-At','-c',identity)
        # Actual server-side TCP identity in the externally verified exact DB namespace.
        require(identity_out.decode().strip()=='acceptance|acceptance|127.0.0.1|5432','DATABASE_IDENTITY')
        if case=='fuel':
            # Generated solely for this fresh exclusively owned pair. No real
            # account/credential is read, altered, persisted or printed.
            reader_password=uuid.uuid4().hex+uuid.uuid4().hex[:16]
            require(reader_password!=password,'DISTINCT_SYNTHETIC_PASSWORD')
            reader_url='postgresql://acceptance_observer:'+reader_password+'@127.0.0.1:5432/acceptance?schema=public'
            sensitive_values.update([reader_password,reader_url])
            settings['DISPOSABLE_READER_DATABASE_URL']=reader_url
            observer_js=r"""const {Client}=require('pg');
const w=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:5000});
const r=new Client({connectionString:process.env.DISPOSABLE_READER_DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:5000});
const must=x=>{if(!x)throw Error('OBSERVER_GATE')};
(async()=>{try{
 await w.connect();
 const pw=new URL(process.env.DISPOSABLE_READER_DATABASE_URL).password;
 // PostgreSQL quotes the sole dynamic literal. Role/database identifiers are fixed.
 const ddl=(await w.query("SELECT format('CREATE ROLE acceptance_observer LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4', $1::text)",[pw])).rows[0].format;
 await w.query(ddl);
 await w.query('REVOKE ALL ON DATABASE acceptance FROM PUBLIC');
 await w.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
 await w.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, acceptance_observer');
 await w.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, acceptance_observer');
 await w.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, acceptance_observer');
 await w.query('GRANT CONNECT ON DATABASE acceptance TO acceptance_observer');
 await w.query('GRANT USAGE ON SCHEMA public TO acceptance_observer');
 await w.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO acceptance_observer');
 await w.query('GRANT pg_read_all_stats TO acceptance_observer WITH INHERIT TRUE, SET FALSE');
 await w.query('ALTER ROLE acceptance_observer SET default_transaction_read_only = on');
 await r.connect();
 // Verify actual password authentication, not merely generated URL metadata.
 must((await w.query("SELECT rolpassword LIKE 'SCRAM-SHA-256$%' scram FROM pg_authid WHERE rolname=$1",['acceptance_observer'])).rows[0].scram);
 must(!(await w.query("SELECT 1 FROM pg_hba_file_rules WHERE type LIKE 'host%' AND (error IS NOT NULL OR auth_method<>'scram-sha-256')")).rows.length);
 const wrong=new URL(process.env.DISPOSABLE_READER_DATABASE_URL);wrong.password='synthetic-deliberately-wrong';
 const probe=new Client({connectionString:wrong.toString(),connectionTimeoutMillis:3000});let rejected=false;
 try{await probe.connect()}catch(e){rejected=e.code==='28P01'}finally{await probe.end()}
 must(rejected);
 const identity="SELECT current_database() db,current_user usr,inet_server_addr()::text host,inet_server_port() port,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid,pg_postmaster_start_time()::text started";
 const wi=(await w.query(identity)).rows[0],ri=(await r.query(identity)).rows[0];
 must(wi.usr==='acceptance'&&ri.usr==='acceptance_observer'&&wi.db==='acceptance'&&ri.db===wi.db&&ri.host===wi.host&&ri.host==='127.0.0.1'&&ri.port===5432&&ri.port===wi.port&&ri.oid===wi.oid&&ri.started===wi.started);
 const flags=(await r.query('SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
 must(flags.rolcanlogin&&!flags.rolsuper&&!flags.rolcreatedb&&!flags.rolcreaterole&&!flags.rolreplication&&!flags.rolbypassrls&&!flags.rolinherit);
 must((await r.query("SELECT pg_has_role(current_user,'pg_read_all_stats','USAGE') inherited")).rows[0].inherited);
 const membership=(await w.query("SELECT m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname=$1 AND r.rolname='pg_read_all_stats'",['acceptance_observer'])).rows;
 must(membership.length===1&&!membership[0].admin_option&&membership[0].inherit_option&&!membership[0].set_option);
 must((await r.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only==='on');
 const bad=(await r.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (pg_has_role(current_user,c.relowner,'USAGE') OR (c.relkind IN ('r','p','v','m','f') AND (NOT has_table_privilege(current_user,c.oid,'SELECT') OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')))" )).rows;
 must(!bad.length);
 must(!(await r.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','f') AND has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')")).rows.length);
 must(!(await r.query("SELECT 1 FROM pg_namespace WHERE has_schema_privilege(current_user,oid,'CREATE') UNION ALL SELECT 1 FROM pg_database WHERE datname=current_database() AND has_database_privilege(current_user,oid,'CREATE,TEMP') UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege(current_user,p.oid,'EXECUTE') UNION ALL SELECT 1 FROM pg_roles WHERE rolname NOT IN ('acceptance_observer','pg_read_all_stats') AND pg_has_role(current_user,oid,'MEMBER')")).rows.length);
 // The dedicated reader contract covers acceptance.public plus CREATE/TEMP
 // on this actual acceptance DB only. Untouched postgres/template defaults
 // are NOT a cluster-wide read-only claim. All role changes are fresh-CI-only.
 // Test ACL denial, not merely default read-only transaction behavior. No rows
 // are selected, and the transaction is rolled back even on unexpected success.
 for(const sql of ['INSERT INTO public."User" SELECT * FROM public."User" WHERE false','UPDATE public."User" SET id=id WHERE false','DELETE FROM public."User" WHERE false']){
  await r.query('BEGIN READ WRITE');let denied=false;
  try{await r.query(sql)}catch(e){denied=e.code==='42501'}finally{await r.query('ROLLBACK')}
  must(denied);
 }
 const pid=(await w.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 await w.query('SELECT pg_advisory_lock(2147483000,5)');
 const seen=(await r.query("SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.pid=$1 AND a.usename='acceptance' AND a.datname=current_database() AND a.query IS NOT NULL AND a.query LIKE '%pg_advisory_lock%' AND l.locktype='advisory' AND l.classid=2147483000::oid AND l.objid=5::oid AND l.granted",[pid])).rows;
 must(seen.length===1);await w.query('SELECT pg_advisory_unlock(2147483000,5)');
 console.log(JSON.stringify({login:'acceptance_observer',writerLogin:'acceptance',database:'acceptance',host:'127.0.0.1',port:5432,databaseOid:ri.oid,serverStarted:ri.started,aclScope:'acceptance.public',globalReadOnlyClaim:false,databaseCreateTempDenied:true,selectOnly:true,roleFlagsVerified:true,effectiveGrantsVerified:true,negativeDmlVerified:true,catalogVisibilityVerified:true,defaultReadOnly:true,freshSyntheticCredential:true,passwordAuthenticationVerified:true}));
}finally{await Promise.allSettled([r.end(),w.end()])}})().catch(()=>{console.error('OBSERVER_PROVISION_OR_VERIFY_REFUSED');process.exitCode=1});"""
            namespace(db,app)
            _,observer_out=execute(app,settings,['node','-e',observer_js],seconds=50)
            observer=json.loads(observer_out)
            require(observer.get('login')=='acceptance_observer' and
                    observer.get('aclScope')=='acceptance.public' and observer.get('globalReadOnlyClaim') is False and
                    observer.get('databaseCreateTempDenied') is True and
                    all(observer.get(k) is True for k in ['selectOnly','roleFlagsVerified',
                    'effectiveGrantsVerified','negativeDmlVerified','catalogVisibilityVerified',
                    'defaultReadOnly','freshSyntheticCredential','passwordAuthenticationVerified']),'OBSERVER_READBACK')
            observer.update({'databaseUrlHash':hashlib.sha256(reader_url.encode()).hexdigest(),
                 'writerDatabaseUrlHash':proof['databaseUrlHash'],'dbId':db,'appId':app,
                 'netInode':inode,'verifiedAfterMigrations':True})
            proof['observer']=observer
            save(case+'-observer.json',observer)
        publish_proof()
        execute(app,settings,['node','--import','tsx','-e',
            "const {assertDisposableIsolation:g}=require('./tests/disposable/assert-isolation.ts'); g(process.env.DISPOSABLE_CASE)"],seconds=20)
        pair={'case':case,'dbId':db,'appId':app,'netInode':inode,
              'storageRoot':'/app/private-files','wholePairCleanup':'PENDING',
              'perRowCleanup':'UNDELETED_UNTIL_WHOLE_PAIR_REMOVAL' if case=='fuel' else 'CASE_SCOPED_NOT_HOST_ASSERTED'}
        receipt['pairs'].append(pair)
        namespace(db,app)
        receipt[case]='RUNNING'; save('receipt.json',receipt)
        code,_=execute(app,settings,['node','node_modules/playwright/cli.js','test',
             '--config=tests/disposable/playwright.config.ts'],seconds=min(210,pair_end-time.monotonic()),check=False)
        # Capture real normal JSON reporter with a bounded stdout reader.
        _,raw=execute(app,basic,['node','-e',"process.stdout.write(require('fs').readFileSync('/tmp/disposable-report.json'))"],seconds=15)
        report=json.loads(raw); save(case+'-report.json',report)
        stats=report['stats']
        specs=[]
        def report_specs(suites):
            for suite in suites:
                specs.extend(suite.get('specs',[])); report_specs(suite.get('suites',[]))
        report_specs(report.get('suites',[]))
        expected_specs=1 if case=='tasks' else 3
        require(len(specs)==expected_specs and all(s['file'].endswith(path.split('/')[-1]) and
                s.get('ok') is True and len(s.get('tests',[]))==1 for s in specs),'REPORT_CASE_IDENTITY')
        for spec in specs:
            results=spec['tests'][0].get('results',[])
            require(len(results)==1 and results[0]['status']=='passed' and results[0].get('retry')==0 and
                    not results[0].get('errors') and not report.get('errors'),'REPORT_NO_RETRY_OR_ERRORS')
        require(code==0 and stats['expected']==expected_specs and stats['unexpected']==0 and stats['flaky']==0 and stats['skipped']==0,
                'CASE_REPORT_OR_EXIT')
        receipt[case]='PASS'
        require(time.monotonic()<pair_end,'PAIR_DEADLINE')
        require(remove_owned(),'PAIR_CLEANUP')
        census([])
        phase_end=float('inf')
    receipt['status']='PASS'
except BaseException as error:
    receipt['status']='HOLD'
    receipt['failureType']=type(error).__name__
    if type(error) is RuntimeError: receipt['failureCode']=str(error)[:100]
finally:
    # Hard failure never falls through into Fuel; always attempt all exact owned removals.
    signal.signal(signal.SIGTERM,signal.SIG_IGN); signal.signal(signal.SIGINT,signal.SIG_IGN)
    clean=remove_owned()
    if not clean: receipt['status']='HOLD'
    for case in CASES:
        if receipt[case]=='RUNNING': receipt[case]='FAIL_OR_UNKNOWN'
    receipt['mainStatus']=receipt.get('status','HOLD')
    if receipt['mainStatus']=='PASS': receipt['status']='PENDING_EXTERNAL_CLEANUP'
    save('receipt.json',receipt)
    print('QUALIFICATION_EVIDENCE='+str(root), flush=True)
    print(json.dumps({k:receipt[k] for k in ['status','tasks','fuel','cleanup']}),flush=True)
    sys.exit(0 if receipt.get('mainStatus')=='PASS' and clean else 1)
PY
