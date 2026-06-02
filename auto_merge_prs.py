import subprocess
import json
import re
import sys
import os

def run_cmd(cmd, check=True, capture=True):
    print(f"Running: {cmd}")
    res = subprocess.run(cmd, shell=True, text=True, capture_output=capture)
    if check and res.returncode != 0:
        if capture:
            print(res.stderr)
        raise Exception(f"Command failed: {cmd}")
    return res

def resolve_cargo_toml(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Failed to read {filepath}: {e}")
        return False
        
    # Find conflict block
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> main\n', re.DOTALL)
    
    def replacer(match):
        head_block = match.group(1)
        main_block = match.group(2)
        
        # We want to keep all keys. Let's parse them as a simple dictionary.
        keys = {}
        for line in head_block.splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                keys[k.strip()] = v.strip()
        for line in main_block.splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                keys[k.strip()] = v.strip()
                
        # Format them back
        res = ""
        # Specific ordering if desired, but arbitrary is fine
        for k, v in keys.items():
            res += f"{k} = {v}\n"
        return res

    new_content, count = pattern.subn(replacer, content)
    if count == 0:
        print(f"Could not find standard conflict block in {filepath}")
        return False
        
    # Check if there are other conflicts
    if '<<<<<<<' in new_content:
        print(f"File {filepath} still has conflict markers")
        return False

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    return True

def main():
    try:
        pr_list_res = run_cmd("gh pr list --state open --json number --limit 100")
        prs = json.loads(pr_list_res.stdout)
    except Exception as e:
        print("Error getting PRs:", e)
        return
        
    manual_prs = []
    success_prs = []

    for pr in prs:
        pr_num = pr['number']
        print(f"\n--- Processing PR {pr_num} ---")
        
        try:
            run_cmd(f"gh pr checkout {pr_num}", check=True)
            merge_res = run_cmd("git merge main --no-edit", check=False)
            
            if merge_res.returncode == 0:
                print("Merge clean. Pushing and merging PR.")
                run_cmd("git push", check=True)
                run_cmd(f"gh pr merge {pr_num} --merge", check=True)
                success_prs.append(pr_num)
                continue
            
            # Conflict happened
            print("Conflict detected.")
            status_res = run_cmd("git status --porcelain", check=True)
            conflicts = []
            for line in status_res.stdout.splitlines():
                if line.startswith("UU ") or line.startswith("AU ") or line.startswith("UA "):
                    conflicts.append(line[3:])
            
            can_resolve = True
            for file in conflicts:
                if not file.endswith("Cargo.toml"):
                    print(f"Non-Cargo.toml conflict: {file}")
                    can_resolve = False
                    break
                
            if can_resolve:
                for file in conflicts:
                    if not resolve_cargo_toml(file):
                        can_resolve = False
                        break
            
            if can_resolve:
                print("Auto-resolved Cargo.toml conflicts.")
                run_cmd("git add .", check=True)
                run_cmd('git commit --no-edit', check=True)
                run_cmd("git push", check=True)
                run_cmd(f"gh pr merge {pr_num} --merge", check=True)
                success_prs.append(pr_num)
            else:
                print(f"Requires manual resolution for PR {pr_num}.")
                run_cmd("git merge --abort", check=True)
                manual_prs.append(pr_num)
                
        except Exception as e:
            print(f"Error processing PR {pr_num}: {e}")
            run_cmd("git merge --abort", check=False)
            manual_prs.append(pr_num)

    print("\n--- Summary ---")
    print("Successfully merged PRs:", success_prs)
    print("Manual intervention needed for PRs:", manual_prs)

if __name__ == "__main__":
    main()
