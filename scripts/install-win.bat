@echo off
REM Installe 1SEC dans Premiere Pro (Windows) en mode developpement.
REM Le dossier du plugin est LIE (jonction) : un "git pull" suffit ensuite,
REM puis le bouton de rechargement dans le panneau - pas besoin de redemarrer Premiere.
setlocal
set "SRC=%~dp0.."
for %%I in ("%SRC%") do set "SRC=%%~fI"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.onesec.sportedit"
if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
if exist "%DEST%" rmdir /S /Q "%DEST%"
mklink /J "%DEST%" "%SRC%"
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo 1SEC installe : %DEST%
echo Redemarrez Premiere Pro UNE fois, puis Fenetre ^> Extensions ^> 1SEC Montage Sport.
pause
