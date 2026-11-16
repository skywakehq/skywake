echo "TIMEOUT = 30" | skywake write app/src/auth.py

skywake fork app agent-1
echo "TIMEOUT = 60" | skywake write app@agent-1/src/auth.py

skywake read app/src/auth.py
skywake read app@agent-1/src/auth.py
skywake branches app

skywake destroy app@agent-1 --yes
