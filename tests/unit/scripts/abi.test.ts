import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  findAbiRegistry,
  getElectronAbi,
  getElectronModulesAbiFromPackage,
  getElectronModulesAbiFromRegistry,
  getElectronVersion,
} from '../../../scripts/lib/abi.cjs';

describe('scripts/lib/abi.cjs', () => {
  it('resolves node-abi registry under the hoisted linker layout', () => {
    const registryPath = findAbiRegistry();
    expect(registryPath).toBeTruthy();
    expect(fs.existsSync(registryPath!)).toBe(true);
    expect(path.basename(registryPath!)).toBe('abi_registry.json');
  });

  it('reads Electron abi_version from the installed package', () => {
    const packageAbi = getElectronModulesAbiFromPackage();
    expect(packageAbi).toMatch(/^\d+$/);
  });

  it('resolves Electron ABI without relying solely on a live binary spawn', () => {
    const abi = getElectronAbi();
    expect(abi).toMatch(/^\d+$/);
    expect(abi).toBe(getElectronModulesAbiFromPackage());
  });

  it('maps the installed Electron major version through the abi registry', () => {
    const version = getElectronVersion();
    expect(version).toBeTruthy();
    const registryAbi = getElectronModulesAbiFromRegistry(version!);
    expect(registryAbi).toMatch(/^\d+$/);
    expect(registryAbi).toBe(getElectronModulesAbiFromPackage());
  });
});
