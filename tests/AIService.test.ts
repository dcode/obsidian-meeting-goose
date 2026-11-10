import { ACPService } from '../src/services/ACPService';

describe('ACPService', () => {
  test('should initialize with default parameters', () => {
    const service = new ACPService();
    expect(service).toBeDefined();
  });

  test('should allow configuring custom command and args', () => {
    const service = new ACPService();
    service.configure('custom-goose', ['--debug', 'acp']);
    expect(service).toBeDefined();
  });
});
