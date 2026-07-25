import re

with open("contracts/token/src/test.rs", "r") as f:
    lines = f.readlines()

out = []
skip = False
for i, line in enumerate(lines):
    if line.strip() == "fn test_accept_ownership_without_proposal_fails() {":
        # we will rewrite this function to actually be valid
        out.append(line)
        out.append("    let env = Env::default();\n")
        out.append("    env.mock_all_auths();\n")
        out.append("    let (client, _) = setup_contract(&env);\n")
        out.append("    let _admin = init_default(&env, &client);\n")
        out.append("    client.accept_ownership();\n")
        out.append("}\n")
        skip = True
        continue
    
    if skip:
        if line.startswith("}"):
            skip = False
        continue
    
    if line.strip() == "// Set expiration to ledger 1000 (future)" and "let current_ledger = env.ledger().sequence();" in lines[i+1]:
        if lines[i-1].strip() == "}":
            # This is the dangling block at 155
            skip = True
            continue

    if line.strip() == "fn test_two_step_ownership_transfer_happy_path() {}":
        out.append("fn test_two_step_ownership_transfer_happy_path() {\n")
        continue

    if line.strip() == "fn test_cancel_transfer() {":
        out.append(line)
        out.append("    let env = Env::default();\n")
        out.append("    env.mock_all_auths();\n")
        out.append("    let (client, _) = setup_contract(&env);\n")
        out.append("    let admin = init_default(&env, &client);\n")
        out.append("    let new_admin = Address::generate(&env);\n")
        out.append("    client.propose_owner(&new_admin);\n")
        out.append("    client.cancel_transfer();\n")
        out.append("    assert!(client.pending_owner().is_none());\n")
        out.append("}\n")
        skip = True
        continue
        
    if line.strip() == "fn test_transfer_ownership_updates_admin() {":
        # there's a dangling 'fn test_transfer_ownership_updates_admin() {' inside a test?
        # wait, let's look at it.
        pass

    out.append(line)

with open("contracts/token/src/test.rs", "w") as f:
    f.writelines(out)
