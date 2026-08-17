import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import provinceBoundaryUrl from '../../Municipal Boundary.geojson?url';
import {
  circleInsideProvince,
  erasePlanningObjects,
  eraserTouchesObject,
  formatMeasurement,
  pathInsideProvince,
  PLANNING_SYMBOLS,
  smoothStroke,
  type PlanningObject,
  type PlanningScenario,
  type ProvinceGeoJSON,
} from '../lib/planning';
import { getPlanningSymbolIcon } from '../lib/planningIcons';
import { usePlanningStore } from '../lib/planningStore';
import { useStore } from '../lib/store';

const ERASER_PIXELS = { small: 12, medium: 24, large: 40 } as const;
const SYMBOL_PIXELS = { small: 28, medium: 36, large: 46 } as const;

function latLngs(coordinates: [number, number][]) {
  return coordinates.map(([lng, lat]) => L.latLng(lat, lng));
}

function coordinates(layer: L.Polyline): [number, number][] {
  const points = layer.getLatLngs() as L.LatLng[] | L.LatLng[][];
  const flat = Array.isArray(points[0]) ? points[0] as L.LatLng[] : points as L.LatLng[];
  return flat.map(point => [point.lng, point.lat]);
}

function dashArray(object: PlanningObject, published = false) {
  if (published || object.style.lineStyle === 'dashed') return '8 6';
  if (object.style.lineStyle === 'dotted') return '2 6';
  return undefined;
}

function symbolIcon(object: PlanningObject, published = false) {
  const size = SYMBOL_PIXELS[object.symbolSize ?? 'medium'];
  return L.divIcon({
    className: 'planning-symbol-wrapper',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="planning-symbol${published ? ' planning-symbol--published' : ''}" style="width:${size}px;height:${size}px;background:${object.style.color}"></div>`,
  });
}

function eraserRadiusMeters(map: L.Map, coordinate: [number, number], pixels: number) {
  const center = latLngs([coordinate])[0];
  const point = map.latLngToContainerPoint(center);
  return map.distance(center, map.containerPointToLatLng(L.point(point.x + pixels, point.y)));
}

function textIcon(object: PlanningObject, published = false, label = false) {
  const content = label ? object.label : object.text;
  const size = object.textSize === 'small' ? 11 : object.textSize === 'large' ? 17 : 13;
  return L.divIcon({
    className: 'planning-text-wrapper',
    iconAnchor: [0, 0],
    html: `<div class="planning-text${object.textBackground ? ' planning-text--background' : ''}${published ? ' planning-text--published' : ''}" style="color:${object.style.color};font-size:${size}px;font-weight:${object.bold ? 700 : 500}"></div>`,
  });
}

function measurementAnchor(object: PlanningObject) {
  const coordinates = object.coordinates;
  if (coordinates.length === 0) return [0, 0] as [number, number];
  return coordinates.reduce<[number, number]>((sum, point) => [sum[0] + point[0] / coordinates.length, sum[1] + point[1] / coordinates.length], [0, 0]);
}

function addArrow(group: L.LayerGroup, tip: [number, number], from: [number, number], color: string, published: boolean) {
  const latitude = (tip[1] + from[1]) / 2 * Math.PI / 180;
  const angle = Math.atan2(-(tip[1] - from[1]), (tip[0] - from[0]) * Math.cos(latitude)) * 180 / Math.PI;
  L.marker(latLngs([tip])[0], {
    interactive: false,
    icon: L.divIcon({
      className: 'planning-arrow-wrapper',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      html: `<span class="planning-arrow${published ? ' planning-arrow--published' : ''}" style="color:${color};transform:rotate(${angle}deg)">➤</span>`,
    }),
  }).addTo(group);
}

type ObjectAction = 'duplicate' | 'front' | 'back' | 'lock' | 'delete';

function renderObject(
  object: PlanningObject,
  group: L.LayerGroup,
  options: { published?: boolean; editable?: boolean; selected?: boolean; onSelect?: (event: L.LeafletMouseEvent) => void; onChange?: (change: Partial<PlanningObject>) => boolean; onAction?: (action: ObjectAction) => void },
) {
  const published = options.published ?? false;
  const pathStyle: L.PathOptions = {
    color: object.style.color,
    weight: object.style.width + (options.selected ? 2 : 0),
    opacity: 0.95,
    fillColor: object.style.color,
    fillOpacity: object.style.fillOpacity,
    dashArray: dashArray(object, published),
    className: published ? 'planning-path--published' : undefined,
  };
  let layer: L.Layer;
  if (object.kind === 'circle') {
    layer = L.circle(latLngs(object.coordinates)[0], { ...pathStyle, radius: object.radiusMeters ?? 50 });
  } else if (object.kind === 'polygon' || object.kind === 'rectangle') {
    layer = L.polygon(latLngs(object.coordinates), pathStyle);
  } else if (object.kind === 'symbol') {
    const marker = L.marker(latLngs(object.coordinates)[0], { icon: symbolIcon(object, published), draggable: Boolean(options.editable && !object.locked) });
    marker.on('add', () => {
      const mount = marker.getElement()?.querySelector('.planning-symbol');
      if (!mount) return;
      const root = createRoot(mount);
      const Icon = getPlanningSymbolIcon(object.symbolKey);
      const size = SYMBOL_PIXELS[object.symbolSize ?? 'medium'];
      root.render(<Icon size={Math.round(size * 0.58)} strokeWidth={2.4} aria-hidden />);
      marker.once('remove', () => root.unmount());
    });
    layer = marker;
  } else if (object.kind === 'text') {
    const marker = L.marker(latLngs(object.coordinates)[0], { icon: textIcon(object, published), draggable: Boolean(options.editable && !object.locked) });
    marker.on('add', () => {
      const element = marker.getElement()?.querySelector('.planning-text');
      if (element) element.textContent = object.text ?? 'Text';
    });
    layer = marker;
  } else {
    layer = L.polyline(latLngs(object.coordinates), pathStyle);
  }
  layer.addTo(group);
  if (object.kind === 'symbol') layer.bindTooltip(PLANNING_SYMBOLS.find(item => item.key === object.symbolKey)?.label ?? 'DRRM symbol', { direction: 'top' });
  if (options.onSelect) layer.on('click', options.onSelect as any);
  if (options.onSelect && options.onAction) layer.on('contextmenu', (event: L.LeafletMouseEvent) => {
    options.onSelect?.(event);
    const menu = document.createElement('div');
    menu.className = 'planning-context-menu';
    const actions: Array<[ObjectAction, string]> = object.locked ? [['lock', 'Unlock']] : [['duplicate', 'Duplicate'], ['front', 'Bring forward'], ['back', 'Send backward'], ['lock', 'Lock'], ['delete', 'Delete']];
    actions.forEach(([action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = object.locked && action === 'delete';
      button.onclick = () => { options.onAction?.(action); layer.closePopup(); };
      menu.append(button);
    });
    layer.bindPopup(menu, { closeButton: false, className: 'planning-context-popup' }).openPopup(event.latlng);
  });

  if (options.editable && !object.locked && options.onChange) {
    if (layer instanceof L.Marker) {
      layer.on('dragend', () => {
        const point = layer.getLatLng();
        if (options.onChange?.({ coordinates: [[point.lng, point.lat]] }) === false) layer.setLatLng(latLngs(object.coordinates)[0]);
      });
    } else if (options.selected && (layer as any).pm) {
      if (object.kind === 'freehand') {
        (layer as any).pm.enableLayerDrag();
        layer.on('pm:dragend', () => {
          if (options.onChange?.({ coordinates: coordinates(layer as L.Polyline) }) === false) (layer as L.Polyline).setLatLngs(latLngs(object.coordinates));
        });
      } else {
        (layer as any).pm.enable({ allowSelfIntersection: false });
        layer.on('pm:edit', () => {
          if (layer instanceof L.Circle) {
            const center = layer.getLatLng();
            if (options.onChange?.({ coordinates: [[center.lng, center.lat]], radiusMeters: layer.getRadius() }) === false) {
              layer.setLatLng(latLngs(object.coordinates)[0]);
              layer.setRadius(object.radiusMeters ?? 50);
            }
          } else if (options.onChange?.({ coordinates: coordinates(layer as L.Polyline) }) === false) {
            (layer as L.Polyline).setLatLngs(latLngs(object.coordinates));
          }
        });
      }
    }
  }

  if (object.kind === 'line' && object.coordinates.length >= 2 && object.arrows !== 'none') {
    const end = object.coordinates.length - 1;
    addArrow(group, object.coordinates[end], object.coordinates[end - 1], object.style.color, published);
    if (object.arrows === 'both') addArrow(group, object.coordinates[0], object.coordinates[1], object.style.color, published);
  }

  if (object.measurementPinned && ['line', 'freehand', 'polygon', 'rectangle', 'circle'].includes(object.kind)) {
    L.marker(latLngs([measurementAnchor(object)])[0], { opacity: 0, interactive: false })
      .bindTooltip(formatMeasurement(object), { permanent: true, direction: 'center', className: 'planning-measurement' })
      .addTo(group);
  }

  if (object.label && object.kind !== 'text') {
    const anchor = object.labelPosition ?? object.coordinates[0];
    const marker = L.marker(latLngs([anchor])[0], { icon: textIcon(object, published, true), draggable: Boolean(options.editable && !object.locked) });
    marker.on('add', () => {
      const element = marker.getElement()?.querySelector('.planning-text');
      if (element) element.textContent = object.label ?? '';
    });
    marker.on('dragend', () => {
      const point = marker.getLatLng();
      if (options.onChange?.({ labelPosition: [point.lng, point.lat] }) === false) marker.setLatLng(latLngs([anchor])[0]);
    });
    marker.addTo(group);
    if (object.labelPosition) L.polyline(latLngs([object.coordinates[0], object.labelPosition]), { color: object.style.color, weight: 1, dashArray: '3 3' }).addTo(group);
  }
  return layer;
}

export function PlanningMapLayer() {
  const map = useMap();
  const planning = usePlanningStore();
  const authorized = useStore(state => state.isMapAuthorized);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const objectLayersRef = useRef(new Map<string, L.Layer>());
  const temporaryRef = useRef<L.Polyline | null>(null);
  const eraserCursorRef = useRef<L.CircleMarker | null>(null);
  const [province, setProvince] = useState<ProvinceGeoJSON | null>(null);
  const scenario = planning.history?.present;
  const canEdit = authorized && (planning.temporary || planning.lockAcquired || !navigator.onLine);

  useEffect(() => {
    fetch(provinceBoundaryUrl).then(response => response.json()).then(setProvince).catch(() => planning.setMessage('Province boundary could not be loaded'));
  }, []);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => { group.remove(); groupRef.current = null; objectLayersRef.current.clear(); };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !scenario) return;
    group.clearLayers();
    objectLayersRef.current.clear();
    const selected = new Set(planning.selectedIds);
    const order = { drawings: 0, symbols: 1, labels: 2 };
    scenario.objects
      .filter(object => scenario.layers[object.layer].visible)
      .slice()
      .sort((a, b) => order[a.layer] - order[b.layer] || a.order - b.order)
      .forEach(object => {
        const layer = renderObject(object, group, {
          editable: canEdit && !scenario.layers[object.layer].locked && planning.tool === 'select',
          selected: selected.has(object.id),
          onSelect: event => {
            L.DomEvent.stopPropagation(event);
            const shift = (event.originalEvent as MouseEvent).shiftKey;
            planning.select(shift ? [...new Set([...planning.selectedIds, object.id])] : [object.id]);
          },
          onChange: change => {
            if (!province) { planning.setMessage('Province boundary is still loading'); return false; }
            const nextCoordinates = change.coordinates ?? object.coordinates;
            const shapeInside = object.kind === 'circle'
              ? circleInsideProvince(nextCoordinates[0], change.radiusMeters ?? object.radiusMeters ?? 50, province)
              : pathInsideProvince(nextCoordinates, province);
            const inside = shapeInside && (!change.labelPosition || pathInsideProvince([change.labelPosition], province));
            if (!inside) { planning.setMessage('Planning objects must remain inside Camarines Norte'); return false; }
            planning.updateObject(object.id, change);
            return true;
          },
          onAction: canEdit && !scenario.layers[object.layer].locked ? action => {
            if (action === 'duplicate') return planning.addObject({ ...structuredClone(object), id: crypto.randomUUID(), order: scenario.objects.length });
            if (action === 'lock') return planning.updateObject(object.id, { locked: !object.locked });
            if (action === 'delete') return planning.removeObjects([object.id]);
            const orders = scenario.objects.map(item => item.order);
            planning.updateObject(object.id, { order: action === 'front' ? Math.max(...orders) + 1 : Math.min(...orders) - 1 });
          } : undefined,
        });
        objectLayersRef.current.set(object.id, layer);
      });
  }, [map, scenario, planning.selectedIds, planning.tool, canEdit, province]);

  useEffect(() => {
    if (!scenario || !canEdit || !province || (planning.tool !== 'box-select' && scenario.layers.drawings.locked)) return;
    map.pm.disableDraw();
    const toolMap: Partial<Record<typeof planning.tool, string>> = { 'box-select': 'Rectangle', line: 'Line', polygon: 'Polygon', rectangle: 'Rectangle', circle: 'Circle' };
    const geomanTool = toolMap[planning.tool];
    if (geomanTool) {
      map.pm.enableDraw(geomanTool as any, {
        pathOptions: {
          color: planning.style.color,
          weight: planning.style.width,
          fillColor: planning.style.color,
          fillOpacity: planning.style.fillOpacity,
          dashArray: dashArray({ style: planning.style } as PlanningObject),
        },
      });
    }
    const created = (event: any) => {
      map.removeLayer(event.layer);
      if (planning.tool === 'box-select') {
        const bounds = event.layer.getBounds() as L.LatLngBounds;
        planning.select(scenario.objects.filter(object => object.coordinates.some(([lng, lat]) => bounds.contains([lat, lng]))).map(object => object.id));
        planning.setTool('select');
        return;
      }
      let nextCoordinates: [number, number][];
      let radiusMeters: number | undefined;
      if (event.layer instanceof L.Circle) {
        const center = event.layer.getLatLng();
        nextCoordinates = [[center.lng, center.lat]];
        radiusMeters = event.layer.getRadius();
      } else nextCoordinates = coordinates(event.layer);
      const inside = radiusMeters === undefined ? pathInsideProvince(nextCoordinates, province) : circleInsideProvince(nextCoordinates[0], radiusMeters, province);
      if (!inside) {
        planning.setMessage('Finish the drawing inside Camarines Norte');
        return;
      }
      const kind = planning.tool === 'line' ? 'line' : planning.tool;
      if (!['line', 'polygon', 'rectangle', 'circle'].includes(kind)) return;
      planning.addObject({
        id: crypto.randomUUID(),
        kind: kind as PlanningObject['kind'],
        layer: 'drawings',
        coordinates: nextCoordinates,
        radiusMeters,
        arrows: kind === 'line' ? 'end' : undefined,
        style: { ...planning.style },
        locked: false,
        order: scenario.objects.length,
      });
      planning.setTool('select');
    };
    const started = (event: any) => {
      const workingLayer = event.workingLayer as L.Polyline | L.Circle;
      const update = () => {
        let object: Pick<PlanningObject, 'kind' | 'coordinates' | 'radiusMeters'>;
        if (workingLayer instanceof L.Circle) {
          const center = workingLayer.getLatLng();
          object = { kind: 'circle', coordinates: [[center.lng, center.lat]], radiusMeters: workingLayer.getRadius() };
        } else {
          object = { kind: planning.tool === 'line' ? 'line' : planning.tool as PlanningObject['kind'], coordinates: coordinates(workingLayer) };
        }
        if (object.coordinates.length >= 2 || object.kind === 'circle') workingLayer.bindTooltip(formatMeasurement(object), { permanent: true, direction: 'top', className: 'planning-measurement' }).openTooltip();
      };
      workingLayer.on('pm:change pm:vertexadded', update);
    };
    map.on('pm:create', created);
    map.on('pm:drawstart', started);
    return () => { map.off('pm:create', created); map.off('pm:drawstart', started); map.pm.disableDraw(); };
  }, [map, planning.tool, planning.style, canEdit, scenario?.objects.length, province]);

  useEffect(() => {
    const blocked = planning.tool === 'freehand'
      ? scenario?.layers.drawings.locked
      : scenario && Object.values(scenario.layers).every(layer => layer.locked);
    if (!scenario || !canEdit || !province || blocked || !['freehand', 'eraser'].includes(planning.tool)) {
      map.dragging.enable();
      temporaryRef.current?.remove();
      eraserCursorRef.current?.remove();
      return;
    }
    map.dragging.disable();
    const container = map.getContainer();
    let points: [number, number][] = [];
    let drawingPointer: number | null = null;
    let radiusMeters = 0;
    const touches = new Set<number>();
    const visualRadii = new Map<string, number>();
    const toCoordinate = (event: PointerEvent): [number, number] => {
      const bounds = container.getBoundingClientRect();
      const point = map.containerPointToLatLng([event.clientX - bounds.left, event.clientY - bounds.top]);
      return [point.lng, point.lat];
    };
    const layerElement = (layer: L.Layer) => layer instanceof L.Marker || layer instanceof L.Path ? layer.getElement() : null;
    const visualRadiusMeters = (object: PlanningObject) => {
      if (object.kind === 'text') return 0;
      if (visualRadii.has(object.id)) return visualRadii.get(object.id)!;
      const element = layerElement(objectLayersRef.current.get(object.id)!);
      const bounds = element?.getBoundingClientRect();
      const pixels = object.kind === 'symbol' && bounds ? Math.max(bounds.width, bounds.height) / 2 : object.style.width / 2;
      const radius = eraserRadiusMeters(map, object.coordinates[0], pixels);
      visualRadii.set(object.id, radius);
      return radius;
    };
    const textTouches = (object: PlanningObject, path: [number, number][]) => {
      if (object.kind !== 'text') return false;
      const element = layerElement(objectLayersRef.current.get(object.id)!)?.querySelector('.planning-text');
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const mapBounds = container.getBoundingClientRect();
      const screenPath = path.map(coordinate => {
        const point = map.latLngToContainerPoint(latLngs([coordinate])[0]);
        return L.point(point.x + mapBounds.left, point.y + mapBounds.top);
      });
      const corners = [L.point(bounds.left, bounds.top), L.point(bounds.right, bounds.top), L.point(bounds.right, bounds.bottom), L.point(bounds.left, bounds.bottom)];
      const cross = (a: L.Point, b: L.Point, c: L.Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const segmentDistance = (a: L.Point, b: L.Point, c: L.Point, d: L.Point) => (
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
          && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
          && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
          ? 0
          : Math.min(L.LineUtil.pointToSegmentDistance(a, c, d), L.LineUtil.pointToSegmentDistance(b, c, d), L.LineUtil.pointToSegmentDistance(c, a, b), L.LineUtil.pointToSegmentDistance(d, a, b))
      );
      const segments = screenPath.length === 1 ? [[screenPath[0], screenPath[0]]] : screenPath.slice(1).map((end, index) => [screenPath[index], end]);
      const inside = (point: L.Point) => point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
      return segments.some(([start, end]) => inside(start) || inside(end) || corners.some((corner, index) => segmentDistance(start, end, corner, corners[(index + 1) % corners.length]) <= ERASER_PIXELS[planning.eraserSize]));
    };
    const clearTargets = () => objectLayersRef.current.forEach(layer => layerElement(layer)?.classList.remove('planning-eraser-target', 'planning-eraser-target--locked'));
    const highlightTargets = (path: [number, number][]) => scenario.objects.forEach(object => {
      if (!scenario.layers[object.layer].visible || !(textTouches(object, path) || eraserTouchesObject(object, path, radiusMeters, visualRadiusMeters(object)))) return;
      const locked = object.locked || scenario.layers[object.layer].locked;
      layerElement(objectLayersRef.current.get(object.id)!)?.classList.add(locked ? 'planning-eraser-target--locked' : 'planning-eraser-target');
    });
    const cancelGesture = () => {
      if (drawingPointer !== null && container.hasPointerCapture?.(drawingPointer)) container.releasePointerCapture?.(drawingPointer);
      drawingPointer = null;
      points = [];
      temporaryRef.current?.remove();
      temporaryRef.current = null;
      clearTargets();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touches.add(event.pointerId);
        if (touches.size > 1) {
          cancelGesture();
          return;
        }
      }
      if (!event.isPrimary || event.button !== 0) return;
      if (event.pointerType !== 'touch') event.preventDefault();
      drawingPointer = event.pointerId;
      container.setPointerCapture?.(event.pointerId);
      points = [toCoordinate(event)];
      if (planning.tool === 'eraser') {
        visualRadii.clear();
        radiusMeters = eraserRadiusMeters(map, points[0], ERASER_PIXELS[planning.eraserSize]);
      }
      temporaryRef.current = L.polyline(latLngs(points), { color: planning.tool === 'eraser' ? '#111827' : planning.style.color, weight: planning.tool === 'eraser' ? 1 : planning.style.width, dashArray: planning.tool === 'eraser' ? '3 3' : dashArray({ style: planning.style } as PlanningObject) }).addTo(map);
      if (planning.tool === 'eraser') highlightTargets(points);
    };
    const pointerMove = (event: PointerEvent) => {
      if (touches.size > 1) return;
      const point = toCoordinate(event);
      if (planning.tool === 'eraser') {
        eraserCursorRef.current?.remove();
        eraserCursorRef.current = L.circleMarker(latLngs([point])[0], { radius: ERASER_PIXELS[planning.eraserSize], color: '#111827', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      }
      if (drawingPointer !== event.pointerId) return;
      points.push(point);
      temporaryRef.current?.setLatLngs(latLngs(points));
      if (planning.tool === 'eraser') highlightTargets(points.slice(-2));
      if (planning.tool === 'freehand' && points.length >= 2) temporaryRef.current?.bindTooltip(formatMeasurement({ kind: 'freehand', coordinates: points }), { permanent: true, direction: 'top', className: 'planning-measurement' }).openTooltip();
    };
    const pointerUp = (event: PointerEvent, cancelled = false) => {
      if (event.pointerType === 'touch') touches.delete(event.pointerId);
      if (drawingPointer !== event.pointerId) return;
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture?.(event.pointerId);
      temporaryRef.current?.remove();
      temporaryRef.current = null;
      if (!cancelled && planning.tool === 'freehand') {
        const smoothed = smoothStroke(points, planning.smoothing);
        if (smoothed.length >= 2 && pathInsideProvince(smoothed, province)) planning.addObject({ id: crypto.randomUUID(), kind: 'freehand', layer: 'drawings', coordinates: smoothed, style: { ...planning.style }, locked: false, order: scenario.objects.length });
        else if (smoothed.length >= 2) planning.setMessage('Freehand strokes must remain inside Camarines Norte');
      } else if (!cancelled && planning.tool === 'eraser' && points.length > 0) {
        const result = erasePlanningObjects(scenario.objects, points, radiusMeters, scenario.layers, visualRadiusMeters, object => textTouches(object, points));
        if (result.erased) planning.edit(current => ({ ...current, objects: result.objects }));
        const messages = [
          result.skipped ? `${result.skipped} locked object${result.skipped === 1 ? '' : 's'} skipped` : '',
          result.limitReached ? 'Object limit reached; some route cuts were skipped' : '',
        ].filter(Boolean);
        if (messages.length) planning.setMessage(messages.join('. '));
      }
      drawingPointer = null;
      points = [];
      clearTargets();
    };
    const pointerCancel = (event: PointerEvent) => pointerUp(event, true);
    const mouseEvent = (event: MouseEvent) => ({
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      preventDefault: () => event.preventDefault(),
    } as PointerEvent);
    const touchEvent = (event: TouchEvent, touch: Touch) => ({
      pointerId: touch.identifier + 2,
      pointerType: 'touch',
      isPrimary: event.touches.length <= 1,
      button: 0,
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => event.preventDefault(),
    } as PointerEvent);
    const mouseDown = (event: MouseEvent) => pointerDown(mouseEvent(event));
    const mouseMove = (event: MouseEvent) => pointerMove(mouseEvent(event));
    const mouseUp = (event: MouseEvent) => pointerUp(mouseEvent(event));
    const touchStart = (event: TouchEvent) => Array.from(event.changedTouches).forEach(touch => pointerDown(touchEvent(event, touch)));
    const touchMove = (event: TouchEvent) => Array.from(event.changedTouches).forEach(touch => pointerMove(touchEvent(event, touch)));
    const touchEnd = (event: TouchEvent) => Array.from(event.changedTouches).forEach(touch => pointerUp(touchEvent(event, touch)));
    if (typeof window.PointerEvent === 'function') {
      container.addEventListener('pointerdown', pointerDown);
      container.addEventListener('pointermove', pointerMove);
      container.addEventListener('pointerup', pointerUp);
      container.addEventListener('pointercancel', pointerCancel);
      window.addEventListener('pointerup', pointerUp);
      window.addEventListener('pointercancel', pointerCancel);
    } else {
      container.addEventListener('mousedown', mouseDown);
      container.addEventListener('mousemove', mouseMove);
      window.addEventListener('mouseup', mouseUp);
      container.addEventListener('touchstart', touchStart);
      container.addEventListener('touchmove', touchMove);
      container.addEventListener('touchend', touchEnd);
      container.addEventListener('touchcancel', touchEnd);
    }
    return () => {
      if (typeof window.PointerEvent === 'function') {
        container.removeEventListener('pointerdown', pointerDown);
        container.removeEventListener('pointermove', pointerMove);
        container.removeEventListener('pointerup', pointerUp);
        container.removeEventListener('pointercancel', pointerCancel);
        window.removeEventListener('pointerup', pointerUp);
        window.removeEventListener('pointercancel', pointerCancel);
      } else {
        container.removeEventListener('mousedown', mouseDown);
        container.removeEventListener('mousemove', mouseMove);
        window.removeEventListener('mouseup', mouseUp);
        container.removeEventListener('touchstart', touchStart);
        container.removeEventListener('touchmove', touchMove);
        container.removeEventListener('touchend', touchEnd);
        container.removeEventListener('touchcancel', touchEnd);
      }
      map.dragging.enable();
      temporaryRef.current?.remove();
      eraserCursorRef.current?.remove();
      clearTargets();
    };
  }, [map, planning.tool, planning.style, planning.smoothing, planning.eraserSize, canEdit, scenario, province]);

  useEffect(() => {
    if (!scenario || !canEdit || !province || !['symbol', 'text'].includes(planning.tool)) return;
    const targetLayer = planning.tool === 'symbol' ? 'symbols' : 'labels';
    if (scenario.layers[targetLayer].locked) return;
    const click = (event: L.LeafletMouseEvent) => {
      const point: [number, number] = [event.latlng.lng, event.latlng.lat];
      if (!pathInsideProvince([point], province)) return planning.setMessage('Planning objects must remain inside Camarines Norte');
      const kind: 'symbol' | 'text' = planning.tool === 'symbol' ? 'symbol' : 'text';
      planning.addObject({
        id: crypto.randomUUID(),
        kind,
        layer: kind === 'text' ? 'labels' : 'symbols',
        coordinates: [point],
        style: { ...planning.style },
        locked: false,
        order: scenario.objects.length,
        symbolKey: kind === 'symbol' ? planning.symbolKey : undefined,
        symbolSize: kind === 'symbol' ? planning.symbolSize : undefined,
        quantity: kind === 'symbol' ? 1 : undefined,
        text: kind === 'text' ? 'Text' : undefined,
        textSize: kind === 'text' ? 'medium' : undefined,
        textBackground: kind === 'text',
      });
      planning.setTool('select');
    };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map, scenario, canEdit, planning.tool, planning.symbolKey, planning.symbolSize, planning.style, province]);

  return null;
}

export function PublishedPlanningLayers() {
  const map = useMap();
  const revisions = usePlanningStore(state => state.publishedOverlays);
  const groupsRef = useRef<L.LayerGroup[]>([]);
  useEffect(() => {
    groupsRef.current.forEach(group => group.remove());
    groupsRef.current = revisions.map(revision => {
      const group = L.layerGroup().addTo(map);
      revision.snapshot.objects
        .filter(object => revision.snapshot.layers[object.layer].visible)
        .forEach(object => renderObject(object, group, { published: true }));
      return group;
    });
    return () => { groupsRef.current.forEach(group => group.remove()); groupsRef.current = []; };
  }, [map, revisions]);
  return null;
}

export function MapScaleControl() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    return () => { control.remove(); };
  }, [map]);
  return null;
}
