release: python manage.py collectstatic --noinput --clear
# Run collectstatic at web start too: Railway does not execute the `release`
# command, so without this WhiteNoise serves the stale committed staticfiles/
# and front-end JS/CSS changes never reach production.
web: python manage.py collectstatic --noinput && gunicorn irrigation_project.wsgi:application --bind 0.0.0.0:$PORT
