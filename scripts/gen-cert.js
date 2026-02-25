/**
 * Generate a self-signed ECDSA cert + key suitable for the WebTransport
 * server. We rely on the standard ``openssl`` binary because Node has no
 * built-in ECDSA cert generator.
 *
 * Usage: ``node scripts/gen-cert.js`` from the repo root.
 *
 * The browser will only trust the cert if you launch Chrome / Chromium with
 *   --webtransport-developer-mode --ignore-certificate-errors-spki-list=<HASH>
 * (or you import the cert into the OS / browser trust store).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.resolve(HERE, "..", "certs");
fs.mkdirSync(CERT_DIR, { recursive: true });

const KEY_PEM = path.join(CERT_DIR, "key.pem");
const CERT_PEM = path.join(CERT_DIR, "cert.pem");
const KEY_DER = path.join(CERT_DIR, "key.der");
const CERT_DER = path.join(CERT_DIR, "cert.der");

const SUBJ = "/CN=localhost";

function sh(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

sh(`openssl ecparam -name prime256v1 -genkey -noout -out "${KEY_PEM}"`);
sh(
  `openssl req -x509 -new -key "${KEY_PEM}" -out "${CERT_PEM}" ` +
    `-days 14 -subj "${SUBJ}" ` +
    `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
);
sh(`openssl pkcs8 -topk8 -nocrypt -in "${KEY_PEM}" -outform DER -out "${KEY_DER}"`);
sh(`openssl x509 -in "${CERT_PEM}" -outform DER -out "${CERT_DER}"`);

const hash = execSync(
  `openssl x509 -in "${CERT_PEM}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64`,
)
  .toString()
  .trim();

console.log(`\nCert written to ${CERT_DIR}.`);
console.log("\nChrome must be launched with:");
console.log(
  `  google-chrome --origin-to-force-quic-on=localhost:4444 --ignore-certificate-errors-spki-list=${hash}`,
);
