"""Convert a bounded pedestrian data extract to a Vestigia graph."""
import argparse
import json
from pathlib import Path
from pedestrian import import_elements

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('latitude',type=float)
    parser.add_argument('longitude',type=float)
    args=parser.parse_args()
    graph=import_elements(json.loads(args.input.read_text()),[args.latitude,args.longitude])
    if not graph['edges']:
        parser.error('No eligible pedestrian edges')
    args.output.write_text(json.dumps(graph,separators=(',',':'))+'\n')
