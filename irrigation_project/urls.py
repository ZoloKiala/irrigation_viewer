from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.contrib.staticfiles.urls import staticfiles_urlpatterns

urlpatterns = [
    path('', include('mapviewer.urls')),
    path('admin/', admin.site.urls),
]

# Serve app static files in development (e.g., logo.svg)
urlpatterns += staticfiles_urlpatterns()
