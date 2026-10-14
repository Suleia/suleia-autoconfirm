import unittest,datetime,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('health',pathlib.Path(__file__).with_name('collect-bounded-runtime-health.py'))
health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)
class HealthTests(unittest.TestCase):
 def test_browser_requires_fresh_heartbeat_capture_and_completed_cycle(self):
  now=datetime.datetime.fromisoformat('2026-10-14T18:20:00+00:00')
  base={'at':now.isoformat(),'readiness':'READY','captureSelfTest':True,'mode':'AUTO'}
  progress={'completedAt':'2026-10-14T18:03:00+00:00'}
  self.assertEqual(health.browser_health(base,progress,now)['health_status'],'HEALTHY')
  for patch in [{'at':'2026-10-14T17:00:00+00:00'},{'captureSelfTest':False},{'readiness':'NOT_READY'}]:
   self.assertEqual(health.browser_health({**base,**patch},progress,now)['health_status'],'UNHEALTHY')
  self.assertEqual(health.browser_health(base,{},now)['health_status'],'UNHEALTHY')
 def test_scheduler_does_not_treat_running_as_success(self):
  now=datetime.datetime.fromisoformat('2026-10-14T18:20:00+00:00')
  cycle={'completedAt':'2026-10-14T18:05:00+00:00','ok':True}
  self.assertEqual(health.scheduler_health(cycle,'active',now)['health_status'],'HEALTHY')
  for bad in [{},{**cycle,'ok':False},{**cycle,'completedAt':'2026-10-14T17:00:00+00:00'}]:
   self.assertEqual(health.scheduler_health(bad,'active',now)['health_status'],'UNHEALTHY')
  self.assertEqual(health.scheduler_health(cycle,'inactive',now)['health_status'],'UNHEALTHY')
if __name__=='__main__':unittest.main()
