@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
node bin/igmp-keepalive.mjs >> logs\igmp-keepalive.log 2>&1
