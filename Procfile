release: python manage.py collectstatic --noinput --clear
web: gunicorn irrigation_project.wsgi:application --bind 0.0.0.0:$PORT
