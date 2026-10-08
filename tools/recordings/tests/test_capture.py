import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('capture',Path(__file__).parents[1]/'capture_serial.py')
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
class CaptureParsing(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(capture.parse_line('64298.0,-0.14,-3.05','legacy'),[64298,-.14,-3.05])
        self.assertEqual(capture.parse_line('0,123,456,1,9000,10000','raw'),[0,123,456,1,9000,10000])
    def test_reject(self):
        for line,mode in [('1,,3','legacy'),('1,NaN,2','legacy'),('0,1,2,1,-3,4','raw'),('0,1,2,1,3.5,4','raw'),('0,1,2,1,16777216,4','raw')]:
            with self.assertRaises(ValueError):capture.parse_line(line,mode)
if __name__=='__main__':unittest.main()
