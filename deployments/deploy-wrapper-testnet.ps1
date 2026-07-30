#!/usr/bin/env pwsh
# Deploy bc-forge-wrapper contract to Stellar Testnet and initialize RBAC storage.
#
# The wrapper contract embeds the admin (RBAC) module.  Deploying and then
# initializing the contract creates the admin role and grants the caller the
# `Admin` role, which implicitly satisfies all role guards (Minter, SuperAdmin,
# Pauser).  Post-deployment, additional roles can be granted via `grant_role`.
#
# .PARAMETER AdminSeed
#   Secret key (seed) of the Stellar account that will become the RBAC admin.
# .PARAMETER RpcUrl
#   Soroban RPC endpoint (default: Soroban Testnet).
# .PARAMETER NetworkPassphrase
#   Network passphrase (default: Testnet passphrase).
#
# Usage: .\deploy-wrapper-testnet.ps1 -AdminSeed "<SECRET_KEY>"
#
# See also:
#   deploy-wrapper-testnet.md  – Full step-by-step guide with RBAC init details
#   docs/ACCESS_CONTROL.md    – RBAC role hierarchy and protected operations

param(
    [Parameter(Mandatory = $true)]
    [string]$AdminSeed,

    [string]$RpcUrl = "https://soroban-testnet.stellar.org",
    [string]$NetworkPassphrase = "Test SDF Network ; September 2015"
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Step 1 — Build WASM
# ---------------------------------------------------------------------------
Write-Host "=== Building WASM ===" -ForegroundColor Cyan
cargo build --target wasm32-unknown-unknown --release -p bc-forge-wrapper
if ($LASTEXITCODE -ne 0) { throw "WASM build failed" }

$WasmPath = "target/wasm32-unknown-unknown/release/bc_forge_wrapper.wasm"
Write-Host "WASM built: $((Get-Item $WasmPath).Length) bytes" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 2 — Deploy contract (no RBAC init yet; deploy first, then initialize)
# ---------------------------------------------------------------------------
Write-Host "=== Deploying Wrapper Contract ===" -ForegroundColor Cyan
$WrapperId = & soroban contract deploy `
    --wasm $WasmPath `
    --source-account $AdminSeed `
    --rpc-url $RpcUrl `
    --network-passphrase $NetworkPassphrase `
    --fee 100
if ($LASTEXITCODE -ne 0) { throw "Wrapper contract deploy failed" }

Write-Host "Wrapper Contract ID: $WrapperId" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 3 — Verify deployment (read-only calls; does NOT initialize RBAC)
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Step 4 — RBAC Initialization (post-deployment)
#
# After deployment the caller MUST invoke `initialize` on the wrapper
# contract.  This call sets the RBAC admin and the underlying token address.
# The admin account implicitly holds every role (Admin, Minter, SuperAdmin,
# Pauser) — no separate grant_role call is needed for the admin.
#
# Additional roles can be granted to other addresses via grant_role.
# ---------------------------------------------------------------------------
# NOTE: This script deploys and verifies only.  RBAC initialization
# (initialize) is performed separately via the commands documented in
# deploy-wrapper-testnet.md (Step 4).

Write-Host "" -ForegroundColor Yellow
Write-Host "=== Deployment Summary ===" -ForegroundColor Cyan
Write-Host "Wrapper Contract ID: $WrapperId" -ForegroundColor Yellow
Write-Host "RPC URL: $RpcUrl" -ForegroundColor Yellow
Write-Host "Network: $NetworkPassphrase" -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow
Write-Host "IMPORTANT: This contract is NOT yet initialized." -ForegroundColor Red
Write-Host "Run the initialization commands from deploy-wrapper-testnet.md (Step 4)" -ForegroundColor Red
Write-Host "to configure the RBAC admin and underlying token before using the contract." -ForegroundColor Red

# Save summary for downstream initialization scripts
$summary = @{
    wrapperContractId = $WrapperId
    rpcUrl = $RpcUrl
    networkPassphrase = $NetworkPassphrase
    deployedAt = (Get-Date -Format "o")
}
$summary | ConvertTo-Json | Set-Content -Path "deployments/wrapper-deployment.json"
Write-Host "Deployment summary saved to deployments/wrapper-deployment.json" -ForegroundColor Green
