// SPDX-License-Identifier: MIT
//! # Fixed-Point Math & Rounding Utilities
//!
//! Provides rounding error mitigation for yield-bearing token vaults.
//! In accordance with vault security best practices (e.g. ERC-4626 standard):
//! - **Deposits (wrap)**: Round shares **down** (floor) so the depositor never receives
//!   unbacked fractional shares ("no free money", preventing share inflation).
//! - **Withdrawals (unwrap)**: Round assets **down** (floor) so the withdrawer never
//!   receives excess fractional underlying tokens from vault reserves.

/// Standard scaling factor for 7-decimal fixed-point precision math.
pub const SCALING_FACTOR: i128 = 10_000_000;

/// Virtual shares and assets added to both sides of the vault exchange rate.
///
/// `10^7` matches the wrapper's decimal scale (the default `decimals` of 7 and
/// [`SCALING_FACTOR`]). Deposits and withdrawals use:
///
/// ```text
/// shares = assets * (total_supply + VIRTUAL_OFFSET) / (total_assets + VIRTUAL_OFFSET)
/// assets = shares * (total_assets + VIRTUAL_OFFSET) / (total_supply + VIRTUAL_OFFSET)
/// ```
///
/// The offset is not minted supply. On an empty vault it cancels, so the first
/// deposit is still 1:1. A direct token donation into that empty vault increases
/// `total_assets` without minting real shares; the virtual shares absorb the
/// donation, so the depositor can withdraw their own assets and the donor
/// cannot.
pub const VIRTUAL_OFFSET: i128 = 10_000_000;

/// Shares minted for `assets` at the virtual-offset exchange rate, rounded down.
///
/// Returns `None` on negative inputs or overflow.
pub fn convert_to_shares(assets: i128, total_supply: i128, total_assets: i128) -> Option<i128> {
    if assets <= 0 || total_supply < 0 || total_assets < 0 {
        return None;
    }
    let supply = total_supply.checked_add(VIRTUAL_OFFSET)?;
    let assets_base = total_assets.checked_add(VIRTUAL_OFFSET)?;
    mul_div_down(assets, supply, assets_base)
}

/// Assets paid for `shares` at the virtual-offset exchange rate, rounded down.
///
/// Returns `None` on negative inputs or overflow.
pub fn convert_to_assets(shares: i128, total_supply: i128, total_assets: i128) -> Option<i128> {
    if shares <= 0 || total_supply < 0 || total_assets < 0 {
        return None;
    }
    let supply = total_supply.checked_add(VIRTUAL_OFFSET)?;
    let assets_base = total_assets.checked_add(VIRTUAL_OFFSET)?;
    mul_div_down(shares, assets_base, supply)
}

/// Integer share price `(total_assets + VIRTUAL_OFFSET) / (total_shares + VIRTUAL_OFFSET)`.
///
/// Returns `None` on negative inputs or overflow. A zero real supply is still
/// defined (the offset is the divisor); callers that require outstanding shares
/// reject that case themselves.
pub fn share_price(total_assets: i128, total_shares: i128) -> Option<i128> {
    if total_assets < 0 || total_shares < 0 {
        return None;
    }
    let assets = total_assets.checked_add(VIRTUAL_OFFSET)?;
    let shares = total_shares.checked_add(VIRTUAL_OFFSET)?;
    Some(assets / shares)
}

/// Multiplies `a` by `b` and divides by `denominator`, rounding **down** (floor).
///
/// Returns `None` if `denominator <= 0` or if intermediate arithmetic overflows.
///
/// # Mathematical Definition
/// $$\lfloor \frac{a \times b}{\text{denominator}} \rfloor$$
#[inline]
pub fn mul_div_down(a: i128, b: i128, denominator: i128) -> Option<i128> {
    if denominator <= 0 || a < 0 || b < 0 {
        return None;
    }

    // Attempt direct checked multiplication
    if let Some(product) = a.checked_mul(b) {
        return Some(product / denominator);
    }

    // Handle large numbers without overflow using 256-bit equivalent or quotient-remainder decomposition
    // a * b / d = (a / d) * b + ((a % d) * b) / d
    let q = a / denominator;
    let r = a % denominator;
    let term1 = q.checked_mul(b)?;
    let term2 = r.checked_mul(b)? / denominator;
    term1.checked_add(term2)
}

/// Multiplies `a` by `b` and divides by `denominator`, rounding **up** (ceil).
///
/// Returns `None` if `denominator <= 0` or if intermediate arithmetic overflows.
///
/// # Mathematical Definition
/// $$\lceil \frac{a \times b}{\text{denominator}} \rceil = \lfloor \frac{a \times b + \text{denominator} - 1}{\text{denominator}} \rfloor$$
#[inline]
pub fn mul_div_up(a: i128, b: i128, denominator: i128) -> Option<i128> {
    if denominator <= 0 || a < 0 || b < 0 {
        return None;
    }

    if a == 0 || b == 0 {
        return Some(0);
    }

    let product = a.checked_mul(b)?;
    let numerator = product.checked_add(denominator.checked_sub(1)?)?;
    Some(numerator / denominator)
}

/// Scales `amount` from `from_decimals` precision to `to_decimals` precision,
/// strictly rounding **down** (floor) when precision is reduced.
///
/// Returns `None` on arithmetic overflow.
#[inline]
pub fn scale_decimals_down(amount: i128, from_decimals: u32, to_decimals: u32) -> Option<i128> {
    if amount < 0 {
        return None;
    }

    if to_decimals >= from_decimals {
        let diff = to_decimals - from_decimals;
        let factor = 10i128.checked_pow(diff)?;
        amount.checked_mul(factor)
    } else {
        let diff = from_decimals - to_decimals;
        let factor = 10i128.checked_pow(diff)?;
        // Integer division in Rust truncates towards zero, which is floor for non-negative values
        Some(amount / factor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mul_div_down_exact() {
        assert_eq!(mul_div_down(100, 200, 50), Some(400));
        assert_eq!(mul_div_down(0, 500, 100), Some(0));
    }

    #[test]
    fn test_mul_div_down_floors_fraction() {
        // 10 * 10 / 3 = 100 / 3 = 33.333... -> 33
        assert_eq!(mul_div_down(10, 10, 3), Some(33));

        // 999 * 1000 / 1001 = 999000 / 1001 = 998.001998... -> 998
        assert_eq!(mul_div_down(999, 1000, 1001), Some(998));
    }

    #[test]
    fn test_mul_div_down_invalid_inputs() {
        assert_eq!(mul_div_down(100, 100, 0), None);
        assert_eq!(mul_div_down(100, 100, -5), None);
        assert_eq!(mul_div_down(-100, 100, 50), None);
        assert_eq!(mul_div_down(100, -100, 50), None);
    }

    #[test]
    fn test_scale_decimals_down() {
        // Upscaling: 100 with 6 decimals -> 7 decimals = 1000
        assert_eq!(scale_decimals_down(100, 6, 7), Some(1000));

        // Downscaling: 1999 with 7 decimals -> 6 decimals = 199 (floored, not 200)
        assert_eq!(scale_decimals_down(1999, 7, 6), Some(199));
        assert_eq!(scale_decimals_down(1005, 7, 6), Some(100));
        assert_eq!(scale_decimals_down(9, 7, 6), Some(0));
    }

    #[test]
    fn test_empty_vault_offset_cancels_to_one_to_one() {
        // shares = assets * OFFSET / OFFSET = assets.
        assert_eq!(convert_to_shares(5_000_000, 0, 0), Some(5_000_000));
        assert_eq!(
            convert_to_assets(5_000_000, 5_000_000, 5_000_000),
            Some(5_000_000)
        );
        assert_eq!(share_price(5_000_000, 5_000_000), Some(1));
    }

    #[test]
    fn test_donation_before_first_deposit_keeps_depositor_whole() {
        // 50_000_000 donated into an empty vault, then a 5_000_000 deposit.
        // shares = 5_000_000 * 10_000_000 / 60_000_000 = 833_333.
        let minted = convert_to_shares(5_000_000, 0, 50_000_000).unwrap();
        assert_eq!(minted, 833_333);

        // Withdrawing those shares returns the deposit, less 2 units of floor dust.
        // The donation stays with the virtual offset; it is not paid out.
        let assets_after = 50_000_000 + 5_000_000;
        let paid = convert_to_assets(minted, minted, assets_after).unwrap();
        assert_eq!(paid, 4_999_998);
        assert_eq!(share_price(assets_after, minted), Some(6));
    }

    #[test]
    fn test_share_price_includes_offset_when_supply_is_nonzero() {
        // (4_000_000 + 10_000_000) / (2_000_000 + 10_000_000) = 1.
        assert_eq!(share_price(4_000_000, 2_000_000), Some(1));
        // 2_000_000 * 14_000_000 / 12_000_000 = 2_333_333.
        assert_eq!(
            convert_to_assets(2_000_000, 2_000_000, 4_000_000),
            Some(2_333_333)
        );
    }

    #[test]
    fn test_exchange_rate_rejects_negative_inputs() {
        assert_eq!(convert_to_shares(0, 0, 0), None);
        assert_eq!(convert_to_shares(-1, 0, 0), None);
        assert_eq!(convert_to_shares(1, -1, 0), None);
        assert_eq!(convert_to_assets(0, 0, 0), None);
        assert_eq!(convert_to_assets(-1, 0, 0), None);
        assert_eq!(convert_to_assets(1, 0, -1), None);
        assert_eq!(share_price(-1, 0), None);
        assert_eq!(share_price(0, -1), None);
    }
}
