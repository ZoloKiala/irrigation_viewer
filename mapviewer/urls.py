# mapviewer/urls.py
from django.urls import path
from . import views

app_name = "mapviewer"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/gee/map/", views.gee_map, name="gee-map"),
    path("api/gee/boundaries/", views.gee_boundaries, name="gee-boundaries"),
    path("api/gee/health/", views.gee_health, name="gee-health"),
    path("api/gee/boundary-geom/", views.gee_boundary_geom, name="gee-boundary-geom"),
    path("api/gee/analyze/", views.gee_analyze, name="gee-analyze"),
    path("api/gee/analyze-admin/", views.gee_analyze_admin, name="gee-analyze-admin"),
    path("api/gee/boundary-at-point/", views.gee_boundary_at_point, name="gee_boundary_at_point"),
    path("api/gee/boundaries-geojson/", views.gee_boundaries_geojson, name="gee_boundaries_geojson"),
      path("api/gee/socio-geojson/", views.gee_socio_geojson, name="gee_socio_geojson"),
    
   

]
