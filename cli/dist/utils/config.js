import Conf from 'conf';
import dotenv from 'dotenv';
dotenv.config();
const schema = {
    rpcUrl: {
        type: 'string',
        default: 'https://soroban-testnet.stellar.org'
    },
    networkPassphrase: {
        type: 'string',
        default: 'Test SDF Network ; September 2015'
    },
    contractId: {
        type: 'string',
    },
    secretKey: {
        type: 'string',
    }
};
const config = new Conf({ schema, projectName: 'bc-forge-cli' });
export function getClientConfig() {
    return {
        rpcUrl: (process.env.RPC_URL || config.get('rpcUrl')),
        networkPassphrase: (process.env.NETWORK_PASSPHRASE || config.get('networkPassphrase')),
        contractId: (process.env.CONTRACT_ID || config.get('contractId')),
    };
}
export function getSecretKey() {
    return (process.env.SECRET_KEY || config.get('secretKey'));
}
export default config;
