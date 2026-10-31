"""Read the supplied Project NOAH 5-year flood hazard shapefile without modifying it."""
import shapefile
from pyproj import CRS

NOAH_FLOOD_STEM = "CamarinesNorte/CamarinesNorte_Flood_5year"
NOAH_FLOOD_CLASSES = {1: "Low", 2: "Medium", 3: "High"}


def read_noah_flood(source_dir):
    stem = source_dir / NOAH_FLOOD_STEM
    if not CRS.from_wkt(stem.with_suffix(".prj").read_text()).equals(CRS.from_epsg(4326), ignore_axis_order=True):
        raise ValueError("NOAH flood source must use WGS84 coordinates")
    with shapefile.Reader(str(stem)) as reader:
        features = []
        for record in reader.iterShapeRecords():
            hazard_class = NOAH_FLOOD_CLASSES.get(record.record.as_dict()["Var"])
            if hazard_class is None:
                raise ValueError(f"Unknown NOAH flood class: {record.record.as_dict()['Var']}")
            features.append({"type": "Feature", "geometry": record.shape.__geo_interface__,
                             "properties": {"hazardClass": hazard_class}})
    if not features:
        raise ValueError("NOAH flood source contains no polygons")
    return {"type": "FeatureCollection", "features": features}
