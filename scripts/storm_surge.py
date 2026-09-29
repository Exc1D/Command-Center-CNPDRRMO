"""Read the supplied SSA1 archive without modifying or extracting its files."""
import io
import zipfile

import shapefile
from pyproj import CRS

STORM_SURGE_ARCHIVE = "CamarinesNorte (4).zip"
STORM_SURGE_STEM = "CamarinesNorte_StormSurge_SSA1"


def read_storm_surge(source_dir):
    with zipfile.ZipFile(source_dir / STORM_SURGE_ARCHIVE) as archive:
        def read(extension):
            return archive.read(f"{STORM_SURGE_STEM}.{extension}")

        if not CRS.from_wkt(read("prj").decode()).equals(CRS.from_epsg(4326), ignore_axis_order=True):
            raise ValueError("SSA1 source must use WGS84 coordinates")
        with shapefile.Reader(shp=io.BytesIO(read("shp")), shx=io.BytesIO(read("shx")),
                              dbf=io.BytesIO(read("dbf"))) as reader:
            features = []
            for record in reader.iterShapeRecords():
                hazard_class = record.record.as_dict()["HAZ"]
                if hazard_class not in (1, 2, 3):
                    raise ValueError(f"Unknown SSA1 source class: {hazard_class}")
                features.append({"type": "Feature", "geometry": record.shape.__geo_interface__,
                                 "properties": {"HAZ": hazard_class, "hazardClass": f"Class {int(hazard_class)}"}})
    if not features:
        raise ValueError("SSA1 source contains no polygons")
    return {"type": "FeatureCollection", "features": features}
