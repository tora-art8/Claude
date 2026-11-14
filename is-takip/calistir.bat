@echo off
REM Windows Görev Zamanlayıcı bu dosyayı çalıştırır.
cd /d "%~dp0"
target\release\is-takip.exe calistir >> is-takip.log 2>&1
