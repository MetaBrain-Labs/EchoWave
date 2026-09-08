param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Python,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$PythonArguments
)

& $Python @PythonArguments
exit $LASTEXITCODE
