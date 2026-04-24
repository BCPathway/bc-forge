import Conf from 'conf';
import dotenv from 'dotenv';

dotenv.config();

const schema = {
	rpcUrl: {
		type: 'string' as const,
		default: 'https://soroban-testnet.stellar.org'
	},
	networkPassphrase: {
		type: 'string' as const,
		default: 'Test SDF Network ; September 2015'
	},
	contractId: {
		type: 'string' as const,
	},
	secretKey: {
		type: 'string' as const,
	}
};

const config = new Conf({ schema, projectName: 'bc-forge-cli' });

export function getClientConfig() {
  return {
    rpcUrl: (process.env.RPC_URL || config.get('rpcUrl')) as string,
    networkPassphrase: (process.env.NETWORK_PASSPHRASE || config.get('networkPassphrase')) as string,
    contractId: (process.env.CONTRACT_ID || config.get('contractId')) as string,
  };
}

export function getSecretKey() {
  return (process.env.SECRET_KEY || config.get('secretKey')) as string;
}

export default config;
