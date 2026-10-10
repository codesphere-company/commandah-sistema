@echo off
rem Gera dist\CommandahImpressora.exe com o compilador C# que já vem no Windows 10/11
rem (.NET Framework 4.8). Não precisa instalar nada.
setlocal
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Compilador C# do .NET Framework 4 nao encontrado.
  exit /b 1
)
if not exist dist mkdir dist
"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 ^
  /out:dist\CommandahImpressora.exe ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  /r:System.Web.Extensions.dll /r:System.Security.dll ^
  src\*.cs
if errorlevel 1 exit /b 1
echo OK: dist\CommandahImpressora.exe
