"""Upgrade stored Vestigia cities."""
from live_world import reconcile_access
from pedestrian import restore_osm_junctions

CURRENT = 5

def upgrade(state):
    version=state.get('format',1)
    if version==CURRENT:
        return
    if version not in (1,2,3,4):
        raise ValueError('Unsupported Vestigia save format')
    if version==1:
        if state['sites'] and not state.get('town_store'):
            state['town_store']=next(s['id'] for s in state['sites'].values() if s['kind']=='town store')
        state.setdefault('opportunities',len(state['tiles']))
        for site in state['sites'].values():
            site.setdefault('conversion',[])
        buffers=[state['cargo']]
        for site in state['sites'].values():
            buffers.extend(site.get(name,[]) for name in ('input','output','shared','materials','upgrade','conversion','pantry'))
        buffers.extend(job['lots'] for job in state['jobs'])
        for stock in buffers:
            for lot in stock:
                lot.setdefault('q',50)
                if lot['good'] in ('log','plank'):
                    lot['good']='pine '+lot['good']
    if version<3:
        for tile in state['tiles'].values():
            if tile['resource']=='field':
                tile['resource']='land'
    graph=state.get('graph')
    if version<4 and graph and restore_osm_junctions(graph):
        reconcile_access(state)
    for citizen in state['citizens']:
        # The founding mentor starts at secondary level. Existing degrees retain their place in the school ladder.
        if citizen['education']==3 or (citizen['education']==2 and citizen['id']!=1):
            citizen['education']+=1
    state['format']=CURRENT
