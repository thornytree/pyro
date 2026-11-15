@echo off
rem Download Daymet (a capped set of cells) and today's Open-Meteo batch into data\daymet_us and data\open-meteo_us.
rem Double-click it or run it from any terminal. Both downloads resume where they stopped, so it is
rem safe to close the windows and run this again. Run it once a day until Open-Meteo's queue is empty.
rem Set PYRO_PYTHON to use an interpreter other than "python" (for example .venv\Scripts\python.exe).
rem Daymet is capped at the first PYRO_DAYMET_CELLS cells in fetch order (a random subset, about
rem 3.3 M of the 7.3 M sample rows at 25000) with PYRO_DAYMET_WORKERS requests at a time. Set either
rem before running to change it; a larger cell count later just continues from what is on disk.
setlocal
cd /d "%~dp0"
if not defined PYRO_PYTHON set PYRO_PYTHON=python
if not defined PYRO_DAYMET_CELLS set PYRO_DAYMET_CELLS=25000
if not defined PYRO_DAYMET_WORKERS set PYRO_DAYMET_WORKERS=8

"%PYRO_PYTHON%" -c "import truststore" 2>nul || "%PYRO_PYTHON%" -m pip install --quiet "truststore>=0.10" || echo truststore could not be installed; continuing without it.

echo Checking the connection to both APIs...
"%PYRO_PYTHON%" -m shared.net
if errorlevel 1 (
    echo.
    echo Connection check failed; nothing was downloaded. See the message above and shared\net.py.
    pause
    exit /b 1
)

rem Open-Meteo: one free-tier batch (9,000 calls, about 2 hours) in its own window.
start "pyro Open-Meteo history" cmd /k ""%PYRO_PYTHON%" -m sources.weather.fetch_history ..\..\data\training\weather_queue.csv.gz ..\..\data\open-meteo_us"

rem Daymet: the Open-Meteo queue's cells first. Prints progress and time left.
"%PYRO_PYTHON%" -m sources.daymet.fetch ..\..\data\training\cells.csv.gz ..\..\data\daymet_us --first ..\..\data\training\weather_queue.csv.gz --target %PYRO_DAYMET_CELLS% --workers %PYRO_DAYMET_WORKERS%
pause
