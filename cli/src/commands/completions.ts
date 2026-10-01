// SPDX-License-Identifier: MIT
import { Command, Option } from "commander";
import logger from "../utils/logger.js";

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

interface CompletionCommand {
  name: string;
  aliases: string[];
  description: string;
  options: string[];
  subcommands: CompletionCommand[];
}

/**
 * `completions bash|zsh|fish` prints a shell script that completes bc-forge
 * commands, subcommands, and flags.
 */
export function createCompletionsCommand(): Command {
  return new Command("completions")
    .description("Print a shell completion script for bash, zsh, or fish")
    .argument("<shell>", "Shell to generate completions for (bash, zsh, or fish)")
    .action(function (this: Command, shell: string) {
      if (!isCompletionShell(shell)) {
        logger.error(
          `Unsupported shell "${shell}". Expected one of: ${COMPLETION_SHELLS.join(", ")}.`,
        );
        process.exitCode = 1;
        return;
      }
      const root = this.parent ?? this;
      process.stdout.write(renderCompletionScript(shell, root));
    });
}

export function renderCompletionScript(shell: CompletionShell, program: Command): string {
  const tree = collectCommand(program);
  switch (shell) {
    case "bash":
      return renderBash(tree);
    case "zsh":
      return renderZsh(tree);
    case "fish":
      return renderFish(tree);
  }
}

function collectCommand(command: Command): CompletionCommand {
  return {
    name: command.name(),
    aliases: command.aliases(),
    description: oneLine(command.description()),
    options: optionFlags(command),
    subcommands: command.commands.map((child) => collectCommand(child)),
  };
}

function optionFlags(command: Command): string[] {
  const flags: string[] = [];
  for (const option of command.options) {
    for (const token of flagTokens(option)) {
      if (!flags.includes(token)) flags.push(token);
    }
  }
  return flags;
}

function flagTokens(option: Option): string[] {
  return option.flags
    .split(/[\s,|]+/)
    .filter((part) => part.startsWith("-") && !part.startsWith("---"));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bashQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function singleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function describe(value: string): string {
  return oneLine(value).replace(/:/g, " -");
}

function renderBash(root: CompletionCommand): string {
  const commands = root.subcommands.map((command) => command.name).join(" ");
  const globalOpts = root.options.join(" ");
  const commandCases = root.subcommands
    .map((command) => renderBashCommandCase(command, globalOpts))
    .join("\n");

  return `# bc-forge bash completion
_bc_forge_complete() {
  local cur
  cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands=${bashQuote(commands)}
  local global_opts=${bashQuote(`${globalOpts} --help --version`.trim())}

  if [[ "\${cur}" == -* ]]; then
    local opts="\${global_opts}"
    case "\${COMP_WORDS[1]}" in
${commandCases}
    esac
    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    return 0
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${COMP_WORDS[1]}" == "completions" && \${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
    return 0
  fi

${renderBashSubcommands(root)}
  return 0
}
complete -o default -F _bc_forge_complete bc-forge
`;
}

function renderBashCommandCase(command: CompletionCommand, globalOpts: string): string {
  const names = [command.name, ...command.aliases];
  const own = [...command.options];
  for (const sub of command.subcommands) {
    own.push(...sub.options);
  }
  const pattern = names.join("|");
  const opts = [globalOpts, ...own].filter(Boolean).join(" ");
  return `      ${pattern})
        opts=${bashQuote(opts)}
        ;;`;
}

function renderBashSubcommands(root: CompletionCommand): string {
  const blocks = root.subcommands
    .filter((command) => command.subcommands.length > 0)
    .map((command) => {
      const names = command.subcommands.map((sub) => sub.name).join(" ");
      return `  if [[ "\${COMP_WORDS[1]}" == "${command.name}" && \${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W ${bashQuote(names)} -- "\${cur}") )
    return 0
  fi`;
    });
  return blocks.join("\n");
}

function renderZsh(root: CompletionCommand): string {
  const commands = root.subcommands
    .map((command) => `    ${singleQuote(`${command.name}:${describe(command.description)}`)}`)
    .join("\n");
  const optionSpecs = collectZshOptions(root);

  return `#compdef bc-forge
# bc-forge zsh completion

_bc_forge() {
  local -a commands
  commands=(
${commands}
  )
  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args' \\
${optionSpecs}
    && return

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        completions)
          _values 'shell' bash zsh fish
          ;;
${renderZshSubcommands(root)}
      esac
      ;;
  esac
}

compdef _bc_forge bc-forge
`;
}

function collectZshOptions(root: CompletionCommand): string {
  const flags = new Set<string>([...root.options, "--help", "--version"]);
  for (const command of root.subcommands) {
    for (const flag of command.options) flags.add(flag);
    for (const sub of command.subcommands) {
      for (const flag of sub.options) flags.add(flag);
    }
  }
  const lines = [...flags].filter((flag) => flag.startsWith("--")).map((flag) => {
    return `    ${singleQuote(`${flag}[${flag.slice(2)}]`)} \\`;
  });
  return lines.join("\n");
}

function renderZshSubcommands(root: CompletionCommand): string {
  return root.subcommands
    .filter((command) => command.subcommands.length > 0)
    .map((command) => {
      const values = command.subcommands
        .map((sub) => `${sub.name}:${describe(sub.description)}`)
        .join(" ");
      return `        ${command.name})
          _describe 'subcommand' ${singleQuote(`(${values})`)}
          ;;`;
    })
    .join("\n");
}

function renderFish(root: CompletionCommand): string {
  const lines: string[] = ["# bc-forge fish completion", "complete -c bc-forge -f"];

  for (const flag of root.options) {
    lines.push(fishOption("__fish_use_subcommand", flag, flag));
  }

  for (const command of root.subcommands) {
    const seen = `__fish_seen_subcommand_from ${command.name}${command.aliases.map((alias) => ` ${alias}`).join("")}`;
    lines.push(
      `complete -c bc-forge -n "__fish_use_subcommand" -a ${singleQuote(command.name)} -d ${singleQuote(describe(command.description))}`,
    );
    for (const flag of command.options) {
      lines.push(fishOption(seen, flag, flag));
    }
    if (command.name === "completions") {
      for (const shell of COMPLETION_SHELLS) {
        lines.push(
          `complete -c bc-forge -n "__fish_seen_subcommand_from completions" -a ${shell} -d ${singleQuote(shell)}`,
        );
      }
    }
    for (const sub of command.subcommands) {
      const subSeen = `__fish_seen_subcommand_from ${command.name}; and not __fish_seen_subcommand_from ${command.subcommands.map((item) => item.name).join(" ")}`;
      lines.push(
        `complete -c bc-forge -n ${singleQuote(subSeen)} -a ${singleQuote(sub.name)} -d ${singleQuote(describe(sub.description))}`,
      );
      const nested = `__fish_seen_subcommand_from ${sub.name}`;
      for (const flag of sub.options) {
        lines.push(fishOption(nested, flag, flag));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function fishOption(condition: string, flag: string, description: string): string {
  if (flag.startsWith("--")) {
    return `complete -c bc-forge -n ${singleQuote(condition)} -l ${singleQuote(flag.slice(2))} -d ${singleQuote(describe(description))}`;
  }
  if (/^-[^-]$/.test(flag)) {
    return `complete -c bc-forge -n ${singleQuote(condition)} -s ${singleQuote(flag.slice(1))} -d ${singleQuote(describe(description))}`;
  }
  return `complete -c bc-forge -n ${singleQuote(condition)} -o ${singleQuote(flag)} -d ${singleQuote(describe(description))}`;
}
