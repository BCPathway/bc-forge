#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String};

use crate::{Action, BcForgeToken, BcForgeTokenClient, TokenError};

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    let admin = Address::generate(env);

    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    (client, admin)
}

#[test]
fn single_admin_mint_transfer_and_pause_still_work() {
    let env = Env::default();
    let (client, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&alice, &100);
    client.transfer(&alice, &bob, &25);
    assert_eq!(client.balance(&alice), 75);
    assert_eq!(client.balance(&bob), 25);

    client.pause();
    assert_eq!(client.try_mint(&alice, &1), Err(Ok(TokenError::ContractPaused)));
    client.unpause();
    client.mint(&alice, &1);
    assert_eq!(client.balance(&alice), 76);
}

#[test]
fn multisig_governs_mint_and_threshold_update() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let signer_a = Address::generate(&env);
    let signer_b = Address::generate(&env);
    let signer_c = Address::generate(&env);
    let governance_admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.enable_multisig_governance(
        &governance_admin,
        &vec![&env, signer_a.clone(), signer_b.clone(), signer_c.clone()],
        &2,
        &10,
    );

    assert!(client.try_mint(&user, &100).is_err());

    let mint_id = client.propose(&signer_a, &Action::Mint(user.clone(), 100));
    assert!(client.try_execute(&mint_id).is_err());
    client.approve_proposal(&signer_b, &mint_id);
    client.execute(&mint_id);
    assert_eq!(client.balance(&user), 100);

    let threshold_id = client.propose(&signer_a, &Action::UpdateThreshold(3));
    client.approve_proposal(&signer_b, &threshold_id);
    client.execute(&threshold_id);

    let ownership_id = client.propose(&signer_a, &Action::TransferOwnership(admin.clone()));
    client.approve_proposal(&signer_b, &ownership_id);
    assert!(client.try_execute(&ownership_id).is_err());
    client.approve_proposal(&signer_c, &ownership_id);
    client.execute(&ownership_id);

    client.mint(&user, &1);
    assert_eq!(client.balance(&user), 101);
}
