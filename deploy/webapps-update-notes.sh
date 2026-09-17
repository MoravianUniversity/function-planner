NAME="function-planner"

# Pull and rebuild after new changes land on the default branch.
# Run as the app user unless a command is prefixed with sudo.

sudo su -l "$NAME"
cd ~/"$NAME"

# Fetch latest code (including pinned submodule commits)
git pull
git submodule update --init --recursive

# Install any new dependencies, then rebuild shared → server → client
npm install
npm run build

# If apps/server/.env.example or config.example.json gained new keys, merge them in:
# nano apps/server/.env
# nano apps/server/config.json
#
# If apps/client/.env changed (e.g. VITE_* vars), edit then rebuild the client:
# nano apps/client/.env
# npm run build -w apps/client

# Apply pending migrations (non-destructive). Never use prisma:setup / migrate reset
# in prod — those wipe data. Do not use prisma:migrate (migrate dev) on the server.
npm run prisma:deploy -w apps/server

exit

# Client dist must stay readable by nginx
sudo chown -R "$NAME":www-data /home/"$NAME"/"$NAME"/apps/client/dist

# Restart the API so it picks up the new server build
sudo systemctl restart function-planner-api.service
sudo systemctl status function-planner-api.service

# Only if deploy/nginx.conf.example changed and you updated the live config:
# sudo nano /etc/nginx/conf.d/"$NAME".conf
# sudo nginx -s reload

# Quick sanity check (adjust host if needed):
# curl -sS https://your.host/healthz
