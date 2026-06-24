#!/usr/bin/env pwsh
# Deploy bc-forge-wrapper contract to Stellar Testnet
# Usage: ./deploy-wrapper-testnet.ps1 -AdminSeed "<SECRET_KEY>"

param(
    [Parameter(Mandatory = $true)]
    [string]$AdminSeed,

    [string]$RpcUrl = "https://soroban-testnet.stellar.org",
    [string]$NetworkPassphrase = "Test SDF Network ; September 2015"
)

$ErrorActionPreference = "Stop"

# Step 1: Build WASM
Write-Host "=== Building WASM ===" -ForegroundColor Cyan
cargo build --target wasm32-unknown-unknown --release -p bc-forge-wrapper
if ($LASTEXITCODE -ne 0) { throw "WASM build failed" }

$WasmPath = "target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm"
Write-Host "WASM built: $((Get-Item $WasmPath).Length) bytes" -ForegroundColor Green

# Step 2: Deploy wrapper contract
Write-Host "=== Deploying Wrapper Contract ===" -ForegroundColor Cyan
$WrapperId = & soroban contract deploy `
    --wasm $WasmPath `
    --source-account $AdminSeed `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    --fee 100
if ($LASTEXITCODE -ne 0) { throw "Wrapper contract deploy failed" }

Write-Host "Wrapper Contract ID: $WrapperId" -ForegroundColor Green

# Step 3: Verify deployment
Write-Host "=== Verifying Deployment ===" -ForegroundColor Cyan
$Version = & soroban contract invoke `
    --id $WrapperId `
    --source-account $AdminSeed `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    --fee 100 `
    -- `
    version
Write-Host "Contract version: $Version" -ForegroundColor Green

$Name = & soroban contract invoke `
    --id $WrapperId `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    -- `
    name
Write-Host "Contract name: $Name" -ForegroundColor Green

$Symbol = & soroban contract invoke `
    --id $WrapperId `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    -- `
    symbol
Write-Host "Contract symbol: $Symbol" -ForegroundColor Green

$Supply = & soroban contract invoke `
    --id $WrapperId `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    -- `
    supply
Write-Host "Initial supply: $Supply" -ForegroundColor Green

# Output results
Write-Host "=== Deployment Summary ===" -ForegroundColor Cyan
Write-Host "Wrapper Contract ID: $WrapperId" -ForegroundColor Yellow
Write-Host "RPC URL: $RpcUrl" -ForegroundColor Yellow
Write-Host "Network: $NetworkPassphrase" -ForegroundColor Yellow

# Save to file
$summary = @{
    wrapperContractId = $WrapperId
    rpcUrl = $RpcUrl
    networkPassphrase = $NetworkPassphrase
    deployedAt = (Get-Date -Format "o")
}
$summary | ConvertTo-Json | Set-Content -Path "deployments/wrapper-deployment.json"
Write-Host "Deployment summary saved to deployments/wrapper-deployment.json" -ForegroundColor Green
