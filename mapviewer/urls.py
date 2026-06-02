# mapviewer/urls.py
from django.urls import path
from . import views

app_name = "mapviewer"

urlpatterns = [
    path("", views.index, name="index"),          # landing page
    path("map/", views.map_view, name="map"),     # the actual map app
    path("api/gee/map/", views.gee_map, name="gee-map"),
    path("api/gee/boundaries/", views.gee_boundaries, name="gee-boundaries"),
    path("api/gee/health/", views.gee_health, name="gee-health"),
    path("api/gee/boundary-geom/", views.gee_boundary_geom, name="gee-boundary-geom"),
    path("api/gee/analyze/", views.gee_analyze, name="gee-analyze"),
    path("api/gee/analyze-admin/", views.gee_analyze_admin, name="gee-analyze-admin"),
    path("api/gee/analyze-irrigation/", views.gee_analyze_irrigation, name="gee_analyze_irrigation"),
    path("api/gee/boundary-at-point/", views.gee_boundary_at_point, name="gee_boundary_at_point"),
    path("api/gee/boundaries-geojson/", views.gee_boundaries_geojson, name="gee_boundaries_geojson"),
    path("api/gee/socio-geojson/", views.gee_socio_geojson, name="gee_socio_geojson"),
    path("api/gee/irrigation-periods/", views.gee_irrigation_periods, name="gee_irrigation_periods"),
    path("api/gee/wapor-periods/", views.gee_wapor_periods, name="gee_wapor_periods"),
    path("api/wapor/tile/<str:dekad>/<int:z>/<int:x>/<int:y>.png", views.wapor_tile, name="wapor_tile"),
    path("api/wapor/timeseries/", views.wapor_timeseries, name="wapor_timeseries"),
    path("api/gee/thumbnail/", views.gee_thumbnail, name="gee_thumbnail"),
    
   

]
