import net from 'net';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT_ALLOCATIONS_FILE = path.join(__dirname, '..', '.port-allocations.json');

/**
 * Robust Port Manager to prevent EADDRINUSE conflicts
 * This system ensures no two services try to use the same port simultaneously
 */
class PortManager extends EventEmitter {
  constructor(minPort = null, maxPort = null) {
    super();
    // Use EasyTravel-style ports with environment variable support
    const portOffset = parseInt(process.env.PORT_OFFSET || '0');
  this.minPort = minPort || (parseInt(process.env.SERVICE_PORT_MIN || '8081') + portOffset);
  // Extend default max port to cover 120 ports (8081-8200) unless overridden by env
  this.maxPort = maxPort || (parseInt(process.env.SERVICE_PORT_MAX || '8200') + portOffset);
    this.allocatedPorts = new Map(); // port -> { service, company, timestamp }
    this.pendingAllocations = new Set(); // ports currently being allocated
    this.allocationLock = new Map(); // service key -> allocation promise
    this.savedPortMap = new Map(); // serviceKey -> port (persisted preferred ports)
    this._loadSavedAllocations();
  console.log(`🔧 [PortManager] Initialized with range ${this.minPort}-${this.maxPort} (${this.maxPort - this.minPort + 1} ports available, ${this.savedPortMap.size} saved port preferences loaded)`);
  }

  /**
   * Check if a port is actually available by attempting to bind to it
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
      
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Find the next available port, checking both our tracking and actual availability
   */
  async findAvailablePort() {
    // First attempt: find port without cleanup
    for (let port = this.minPort; port <= this.maxPort; port++) {
      // Skip if we think it's allocated or being allocated
      if (this.allocatedPorts.has(port) || this.pendingAllocations.has(port)) {
        continue;
      }
      
      // Double-check by actually testing the port
      if (await this.isPortAvailable(port)) {
        return port;
      } else {
        // Port is actually in use but not in our tracking - add to allocated
        console.log(`⚠️ [PortManager] Port ${port} in use but not tracked - adding to tracking`);
        this.allocatedPorts.set(port, { 
          service: 'unknown', 
          company: 'unknown', 
          timestamp: Date.now() 
        });
      }
    }
    
    // Second attempt: Aggressively clean up stale allocations (ports freed externally)
    console.log(`⚠️ [PortManager] No ports found on first scan, attempting aggressive cleanup...`);
    try {
      const cleaned = await this.cleanupStaleAllocations();
      console.log(`🧹 [PortManager] Cleaned ${cleaned} stale allocations, retrying port scan`);
      
      if (cleaned > 0) {
        // Retry with fresh scan after cleanup
        for (let port = this.minPort; port <= this.maxPort; port++) {
          if (this.allocatedPorts.has(port) || this.pendingAllocations.has(port)) continue;
          if (await this.isPortAvailable(port)) {
            console.log(`✅ [PortManager] Found available port ${port} after cleanup`);
            return port;
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ [PortManager] Cleanup attempt failed: ${e.message}`);
    }

    // If still no port available, log detailed status for debugging
    const status = this.getStatus();
    console.error(`❌ [PortManager] Port exhaustion - Allocated: ${status.allocatedPorts}/${status.totalPorts}, Pending: ${status.pendingAllocations}`);
    console.error(`   Active allocations:`, status.allocations.slice(0, 10)); // Show first 10
    
    throw new Error(`No available ports in range ${this.minPort}-${this.maxPort} (${status.allocatedPorts} allocated, ${status.pendingAllocations} pending)`);
  }

  /**
   * Allocate a port for a service with proper locking to prevent race conditions
   */
  async allocatePort(serviceName, companyName = 'default') {
    const serviceKey = `${serviceName}-${companyName}`;
    
    // Check if we already have an allocation in progress for this service
    if (this.allocationLock.has(serviceKey)) {
      console.log(`🔄 [PortManager] Waiting for existing allocation for ${serviceKey}`);
      return await this.allocationLock.get(serviceKey);
    }
    
    // Create allocation promise with proper locking
    const allocationPromise = this._performAllocation(serviceName, companyName, serviceKey);
    this.allocationLock.set(serviceKey, allocationPromise);
    
    try {
      const result = await allocationPromise;
      return result;
    } finally {
      this.allocationLock.delete(serviceKey);
    }
  }

  /**
   * Internal allocation logic with proper synchronization
   */
  async _performAllocation(serviceName, companyName, serviceKey) {
    // Check if service already has a port allocated
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (allocation.service === serviceName && allocation.company === companyName) {
        console.log(`♻️ [PortManager] Reusing existing port ${port} for ${serviceKey}`);
        return port;
      }
    }
    
    // Check if we have a saved preferred port from previous session
    let port = null;
    const savedPort = this.savedPortMap.get(serviceKey);
    if (savedPort && !this.allocatedPorts.has(savedPort) && !this.pendingAllocations.has(savedPort)) {
      if (await this.isPortAvailable(savedPort)) {
        port = savedPort;
        console.log(`📌 [PortManager] Restoring saved port ${port} for ${serviceKey}`);
      } else {
        console.log(`⚠️ [PortManager] Saved port ${savedPort} for ${serviceKey} is no longer available, allocating new`);
      }
    }
    
    // Find and reserve a new port if no saved port was usable
    if (!port) port = await this.findAvailablePort();
    
    // Mark as pending to prevent double allocation
    this.pendingAllocations.add(port);
    
    try {
      // Double-check port is still available after marking as pending
      if (!(await this.isPortAvailable(port))) {
        throw new Error(`Port ${port} became unavailable during allocation`);
      }
      
      // Allocate the port
      this.allocatedPorts.set(port, {
        service: serviceName,
        company: companyName,
        timestamp: Date.now()
      });
      
      console.log(`✅ [PortManager] Allocated port ${port} to ${serviceKey} (${this.allocatedPorts.size} total allocated)`);
      this.emit('portAllocated', { port, serviceName, companyName });
      
      // Persist the allocation for next restart
      this._saveAllocations();
      
      return port;
      
    } finally {
      this.pendingAllocations.delete(port);
    }
  }

  /**
   * Release a port when service stops
   */
  releasePort(port, serviceName = null) {
    const allocation = this.allocatedPorts.get(port);
    
    if (!allocation) {
      console.log(`⚠️ [PortManager] Attempted to release untracked port ${port}`);
      return false;
    }
    
    if (serviceName && allocation.service !== serviceName) {
      console.log(`⚠️ [PortManager] Service mismatch releasing port ${port}: expected ${serviceName}, got ${allocation.service}`);
      return false;
    }
    
    this.allocatedPorts.delete(port);
    console.log(`🔓 [PortManager] Released port ${port} from ${allocation.service}-${allocation.company} (${this.allocatedPorts.size} remaining)`);
    this.emit('portReleased', { port, allocation });
    
    // Note: we do NOT remove from savedPortMap on release — we want to remember
    // the preferred port so the service gets the same port on next restart
    
    return true;
  }

  /**
   * Get port for a specific service if already allocated
   */
  getServicePort(serviceName, companyName = 'default') {
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (allocation.service === serviceName && allocation.company === companyName) {
        return port;
      }
    }
    return null;
  }

  /**
   * Check if a service is running (has allocated port)
   */
  isServiceRunning(serviceName, companyName = 'default') {
    return this.getServicePort(serviceName, companyName) !== null;
  }

  /**
   * Get status report of all allocations
   */
  getStatus() {
    const allocations = Array.from(this.allocatedPorts.entries()).map(([port, allocation]) => ({
      port,
      service: allocation.service,
      company: allocation.company,
      uptime: Date.now() - allocation.timestamp
    }));
    
    return {
      totalPorts: this.maxPort - this.minPort + 1,
      allocatedPorts: this.allocatedPorts.size,
      pendingAllocations: this.pendingAllocations.size,
      availablePorts: (this.maxPort - this.minPort + 1) - this.allocatedPorts.size - this.pendingAllocations.size,
      allocations
    };
  }

  /**
   * Clean up stale allocations (ports that are no longer actually in use)
   */
  async cleanupStaleAllocations() {
    const staleAllocations = [];
    
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (await this.isPortAvailable(port)) {
        staleAllocations.push(port);
      }
    }
    
    for (const port of staleAllocations) {
      const allocation = this.allocatedPorts.get(port);
      console.log(`🧹 [PortManager] Cleaning up stale allocation: port ${port} from ${allocation.service}-${allocation.company}`);
      this.releasePort(port);
    }
    
    return staleAllocations.length;
  }

  /**
   * Release all ports for a specific company
   * Used when user wants to restart a specific company's journey
   */
  releasePortsForCompany(companyName) {
    const portsToRelease = [];
    
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (allocation.company === companyName) {
        portsToRelease.push({ port, service: allocation.service });
      }
    }
    
    for (const { port, service } of portsToRelease) {
      this.releasePort(port, service);
    }
    
    console.log(`🧹 [PortManager] Released ${portsToRelease.length} ports for company: ${companyName}`);
    return portsToRelease.length;
  }

  /**
   * Get all allocated ports for a specific company
   */
  getPortsForCompany(companyName) {
    const ports = [];
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (allocation.company === companyName) {
        ports.push({ port, service: allocation.service, timestamp: allocation.timestamp });
      }
    }
    return ports;
  }

  /**
   * Get allocation summary by company
   */
  getAllocationsByCompany() {
    const byCompany = {};
    for (const [port, allocation] of this.allocatedPorts.entries()) {
      if (!byCompany[allocation.company]) {
        byCompany[allocation.company] = [];
      }
      byCompany[allocation.company].push({ port, service: allocation.service });
    }
    return byCompany;
  }
  /**
   * Public method to save current port state - called during graceful shutdown
   */
  saveState() {
    this._saveAllocations();
    console.log(`💾 [PortManager] Port state saved (${this.allocatedPorts.size} active, ${this.savedPortMap.size} saved preferences)`);
  }

  /**
   * Save current allocations to disk for port persistence across restarts
   */
  _saveAllocations() {
    try {
      const data = {};
      for (const [port, allocation] of this.allocatedPorts.entries()) {
        const key = `${allocation.service}-${allocation.company}`;
        data[key] = port;
      }
      // Also merge any saved ports that aren't currently active (preserve history)
      for (const [key, port] of this.savedPortMap.entries()) {
        if (!data[key]) data[key] = port;
      }
      fs.writeFileSync(PORT_ALLOCATIONS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn(`⚠️ [PortManager] Failed to save port allocations: ${err.message}`);
    }
  }

  /**
   * Load saved port allocations from disk to restore preferred port mappings
   */
  _loadSavedAllocations() {
    try {
      if (fs.existsSync(PORT_ALLOCATIONS_FILE)) {
        const raw = fs.readFileSync(PORT_ALLOCATIONS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        for (const [key, port] of Object.entries(data)) {
          const portNum = parseInt(port);
          if (portNum >= this.minPort && portNum <= this.maxPort) {
            this.savedPortMap.set(key, portNum);
          }
        }
        console.log(`📂 [PortManager] Loaded ${this.savedPortMap.size} saved port preferences from disk`);
      }
    } catch (err) {
      console.warn(`⚠️ [PortManager] Failed to load saved port allocations: ${err.message}`);
    }
  }
}

// Export singleton instance
export const portManager = new PortManager();
export default portManager;