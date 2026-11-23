"""Upgrade stored cities from the first Vestigia fixture save format."""
CURRENT = 2

def upgrade(state):
    version=state.get('format',1)
    if version==CURRENT:
        return
    if version!=1:
        raise ValueError('Unsupported Vestigia save format')
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
    state['format']=CURRENT
