NAME="function-planner"

# sudo apt update
# sudo apt install git curl nano nginx libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static nodejs npm postgresql postgresql-contrib certbot python3-certbot-nginx python3-certbot-dns-cloudflare

# Get wildcard DNS certificate for the base domain
# echo "dns_cloudflare_api_token = your-api-token" | sudo tee /etc/letsencrypt/cloudflare.ini
# sudo chmod 600 /etc/letsencrypt/cloudflare.ini
# sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d 'domain.com' -d '*.domain.com' --deploy-hook "systemctl reload nginx"

# Setup a new database and user for this app, run the following commands:
# sudo -u postgres psql
#     -- App login role (not a superuser)
#     CREATE ROLE function_planner_user WITH LOGIN PASSWORD 'choose-a-strong-password';
#     ALTER ROLE function_planner_user CREATEDB;
#     -- Database owned by that role
#     CREATE DATABASE function_planner OWNER function_planner_user;
#     -- Connect to the new DB, then grant schema rights
#     \c function_planner
#     GRANT CONNECT ON DATABASE function_planner TO function_planner_user;
#     GRANT USAGE, CREATE ON SCHEMA public TO function_planner_user;
#     ALTER DEFAULT PRIVILEGES IN SCHEMA public
#     GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO function_planner_user;
#     ALTER DEFAULT PRIVILEGES IN SCHEMA public
#     GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO function_planner_user;
#     -- Optional: make sure public schema stays usable for this role on newer Postgres
#     GRANT ALL ON SCHEMA public TO function_planner_user;
#     \q

# Create a new user and switch to that user
sudo useradd -m "$NAME" -s /bin/bash
sudo su -l "$NAME"

# Add keys
mkdir -p .ssh
cat >.ssh/authorized_keys  # from any public key you want to allow access
cat >.ssh/id_ed25519       # for access to github
cat >.ssh/id_ed25519.pub   # for access to github
chown -R "$NAME":"$NAME" .ssh
chmod 700 .ssh
chmod 600 .ssh/authorized_keys
chmod 600 .ssh/id_ed25519
chmod 644 .ssh/id_ed25519.pub

# Install nvm (Node Version Manager) and updated node
NVM_VERSION="0.40.7"
NODE_VERSION="24.21.0"  # use nvm ls-remote to see all available versions, this was the latest LTS version at the time of writing
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v$NVM_VERSION/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install v$NODE_VERSION

# Clone the repo
NAME="function-planner"
REPO="git@github.com:MoravianUniversity/$NAME.git"
git clone "$REPO" "$NAME"
cd "$NAME"

# Unique install steps for this repo
git submodule update --init --recursive
npm install
npm run build -w packages/shared

cp apps/server/.env.example apps/server/.env
nano apps/server/.env
npm run build -w apps/server
npm run prisma:setup -w apps/server
cp apps/server/config.example.json apps/server/config.json
nano apps/server/config.json
ln -s "$PWD"/apps/server/config.json apps/server/dist/src/config.json

cp apps/client/.env.example apps/client/.env
nano apps/client/.env
npm run build -w apps/client  # after editing the .env file, you need to rebuild the client so that the new environment variables are included in the build


# Copy the example nginx config and systemd service files and edit them to match the domain name and paths.
exit
sudo chown -R "$NAME":www-data /home/"$NAME"/"$NAME"/apps/client/dist
sudo chmod a+x /home/"$NAME"
sudo cp /home/"$NAME"/"$NAME"/deploy/nginx.conf.example /etc/nginx/conf.d/"$NAME".conf
sudo nano /etc/nginx/conf.d/"$NAME".conf
sudo nginx -s reload

sudo cp /home/"$NAME"/"$NAME"/deploy/systemd/function-planner-api.service.example /etc/systemd/system/function-planner-api.service
sudo nano /etc/systemd/system/function-planner-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now function-planner-api.service
