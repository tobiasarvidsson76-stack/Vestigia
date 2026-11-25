"""Fetch and share bounded pedestrian extracts for location-based city setup."""
import json
import math
from functools import lru_cache
from threading import Lock
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pedestrian import import_elements, unproject

AREA_SIZE = .01
OVERLAP = .004
CACHE_LOCK = Lock()


def area_at(latitude, longitude):
    return (math.floor(latitude / AREA_SIZE), math.floor(longitude / AREA_SIZE))


def area_origin(area):
    return [(index + .5) * AREA_SIZE for index in area]


def legacy_areas(graph):
    if not graph['edges']:
        return set()
    points = (point for edge in graph['edges'].values() for point in (edge['p'], edge['q']))
    first = next(points)
    xmin = xmax = first['x']
    ymin = ymax = first['y']
    for point in points:
        xmin, xmax = min(xmin, point['x']), max(xmax, point['x'])
        ymin, ymax = min(ymin, point['y']), max(ymax, point['y'])
    southwest = unproject(graph['origin'], xmin, ymax)
    northeast = unproject(graph['origin'], xmax, ymin)
    start = area_at(**southwest)
    end = area_at(**northeast)
    # Edge areas may contain only a partial legacy extract.
    return {(i, j) for i in range(start[0] + 1, end[0])
            for j in range(start[1] + 1, end[1])}


@lru_cache(maxsize=96)
def load_area(endpoint, area):
    latitude, longitude = area_origin(area)
    extent = AREA_SIZE / 2 + OVERLAP
    south, north = max(-90, latitude - extent), min(90, latitude + extent)
    longitude_extent=AREA_SIZE/2+max(OVERLAP,230/(111_195*max(.01,math.cos(math.radians(latitude)))))
    west, east = max(-180, longitude - longitude_extent), min(180, longitude + longitude_extent)
    bounds = f'{south:.6f},{west:.6f},{north:.6f},{east:.6f}'
    query = f'[out:json][timeout:15];way["highway"]({bounds});(._;>;);out body;'
    request = Request(endpoint + ('&' if '?' in endpoint else '?') + urlencode({'data': query}),
                      headers={'User-Agent': 'Vestigia pedestrian map preview/1.0',
                               'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=22) as response:
            content = response.read(8_000_001)
        if len(content) > 8_000_000:
            raise ValueError('Oversize map response')
        data = json.loads(content)
        if not isinstance(data, dict) or not isinstance(data.get('elements'), list) or data.get('remark'):
            raise ValueError('Incomplete map response')
        return data
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise ConnectionError('Walking map data is temporarily unavailable. Try again in a moment.') from exc


def prepare_areas(endpoint, graph, stored, locations):
    known = {tuple(area) for area in stored} if stored is not None else legacy_areas(graph)
    wanted = list(dict.fromkeys(area_at(*location) for location in locations))
    missing = [area for area in wanted if area not in known]
    if not missing:
        return known, []
    # Keep the demo provider shared and avoid duplicate requests for concurrent starts in the same area.
    with CACHE_LOCK:
        return known, [(area, load_area(endpoint, area)) for area in missing]


def merge_areas(graph, known, extracts):
    added = False
    for area, data in extracts:
        if area in known:
            continue
        if graph['origin'] is None:
            graph['origin'] = area_origin(area)
        for key, edge in import_elements(data, graph['origin'])['edges'].items():
            if key not in graph['edges']:
                graph['edges'][key] = edge
                added = True
        known.add(area)
    return added
