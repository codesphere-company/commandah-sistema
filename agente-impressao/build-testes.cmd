@echo off
rem Gera dist\Testes.exe (console) com o mesmo compilador do build.cmd. Sem framework de teste.
rem Roda: dist\Testes.exe  (código de saída 0 só se tudo passar)
setlocal
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Compilador C# do .NET Framework 4 nao encontrado.
  exit /b 1
)
if not exist dist mkdir dist
"%CSC%" /nologo /target:exe /optimize+ /platform:anycpu /codepage:65001 ^
  /main:Commandah.Agente.Testes.Principal ^
  /out:dist\Testes.exe ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  /r:System.Web.Extensions.dll /r:System.Security.dll ^
  src\*.cs tests\*.cs
if errorlevel 1 exit /b 1
echo OK: dist\Testes.exe
