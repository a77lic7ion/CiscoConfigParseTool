import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Upload, FileText, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import logoImage from './assets/logo.jpg'
import './App.css'

function App() {
  const [parsedConfigs, setParsedConfigs] = useState([])
  const [currentPage, setCurrentPage] = useState(0)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef(null)

  const sanitize = (str) => {
    if (!str) return ''
    return str.replace(/[<>"'`\n\r]/g, char => ({
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '`': '&#96;',
      '\n': ' ',
      '\r': ' '
    }[char] || char))
  }

  const parseCiscoConfig = (text) => {
    const lines = text.split('\n').map(line => line.trim())
    const data = {
      general: {},
      vlans: [],
      svis: [],
      ports: [],
      routing: {},
      ospf: { status: 'Not configured', details: [] },
      uplinks: [],
      portChannels: 'Not configured',
      other: {},
      securityPresent: [],
      securityMissing: [
        'Firewall or interface ACLs',
        '802.1X port-based authentication',
        'MAC address filtering or port security',
        'VPN or IPsec configurations',
        'Intrusion prevention/detection systems',
        'TACACS+ or RADIUS authentication',
        'NetFlow or sFlow for traffic monitoring'
      ],
      snmp: { status: 'Not configured', details: [] },
      connections: [],
      ipRanges: [],
      missingItems: []
    }

    let currentInterface = null
    let portRange = []
    let lastPortConfig = null
    let inVlanDatabase = false
    let inOSPFSection = false
    let inPortChannel = false
    let hasCDP = false
    let hasLLDP = false
    let hasNTP = false

    // Ensure VLAN 1 is included
    data.vlans.push({ id: '1', name: 'default' })

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // General Device Information
      if (line.match(/^hostname\s+(.+)/)) {
        data.general.hostname = line.match(/^hostname\s+(.+)/)[1]
      } else if (line.match(/^version\s+([\d.]+)/)) {
        data.general.iosVersion = line.match(/^version\s+([\d.]+)/)[1]
      } else if (line.match(/switch\s+\d+\s+provision\s+(\S+)/)) {
        data.general.model = line.match(/switch\s+\d+\s+provision\s+(\S+)/)[1]
      } else if (line.match(/nxos\s+([\d.]+)/i)) {
        data.general.os = 'NX-OS'
        data.general.iosVersion = line.match(/nxos\s+([\d.]+)/i)[1]
      } else if (line.includes('Last configuration change')) {
        data.general.lastChange = line.split('at ')[1] || line
      } else if (line.match(/Current configuration\s*:\s*(\d+)/)) {
        data.general.configSize = line.match(/Current configuration\s*:\s*(\d+)/)[1] + ' bytes'
      } else if (line.match(/^System\s+uptime\s+is\s+(.+)/)) {
        data.general.uptime = line.match(/^System\s+uptime\s+is\s+(.+)/)[1]
      } else if (line.match(/^System\s+serial\s+number\s*:\s*(\S+)/)) {
        data.general.serialNumber = line.match(/^System\s+serial\s+number\s*:\s*(\S+)/)[1]
      } else if (line.match(/^Base\s+ethernet\s+MAC\s+Address\s*:\s*(\S+)/)) {
        data.general.macAddress = line.match(/^Base\s+ethernet\s+MAC\s+Address\s*:\s*(\S+)/)[1]
      } else if (line.match(/^Processor\s+Board\s+ID\s+(\S+)/)) {
        data.general.boardID = line.match(/^Processor\s+Board\s+ID\s+(\S+)/)[1]
      } else if (line.match(/^Memory\s+size\s*:\s*(\S+)/)) {
        data.general.memory = line.match(/^Memory\s+size\s*:\s*(\S+)/)[1]
      } else if (line.match(/^System\s+image\s+file\s+is\s+"(\S+)"/)) {
        data.general.bootImage = line.match(/^System\s+image\s+file\s+is\s+"(\S+)"/)[1]
      } else if (line.match(/^Configuration\s+register\s+is\s+(\S+)/)) {
        data.general.configRegister = line.match(/^Configuration\s+register\s+is\s+(\S+)/)[1]
      }

      // VLANs
      if (line.match(/^vlan\s+(\d+)/) || (inVlanDatabase && line.match(/^\s*vlan\s+(\d+)/))) {
        if (line.includes('vlan database')) {
          inVlanDatabase = true
          continue
        }
        const vlanId = line.match(/vlan\s+(\d+)/)[1]
        let vlanName = 'N/A'
        
        // Look for name on same line or next line
        if (line.includes('name ')) {
          vlanName = line.split('name ')[1]
        } else if (i + 1 < lines.length && lines[i + 1].trim().startsWith('name ')) {
          vlanName = lines[i + 1].trim().split('name ')[1]
        }
        
        // Check if VLAN already exists (avoid duplicates)
        if (!data.vlans.find(v => v.id === vlanId)) {
          data.vlans.push({ id: vlanId, name: vlanName })
        }
      }

      // SVIs (VLAN interfaces) - Fixed implementation
      if (line.match(/^interface\s+vlan\s*(\d+)/i)) {
        const vlanId = line.match(/^interface\s+vlan\s*(\d+)/i)[1]
        const svi = {
          vlan: vlanId,
          name: `VLAN${vlanId}`,
          ipAddress: 'No IP address',
          subnetMask: 'N/A',
          networkCIDR: 'N/A',
          usableRange: 'N/A',
          freeIPs: 0,
          additionalInfo: 'shutdown',
          availableIPs: []
        }

        // Look ahead for SVI configuration
        for (let j = i + 1; j < lines.length && !lines[j].match(/^interface\s+/) && !lines[j].match(/^!/); j++) {
          const configLine = lines[j].trim()
          
          if (configLine.match(/ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/)) {
            const ipMatch = configLine.match(/ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/)
            svi.ipAddress = ipMatch[1]
            svi.subnetMask = ipMatch[2]
            
            // Calculate CIDR and network info
            const cidr = subnetMaskToCIDR(ipMatch[2])
            svi.networkCIDR = `${getNetworkAddress(ipMatch[1], ipMatch[2])}/${cidr}`
            
            const usableIPs = calculateUsableIPs(cidr)
            svi.usableRange = getUsableRange(ipMatch[1], ipMatch[2])
            svi.freeIPs = usableIPs - 1 // Subtract 1 for the interface IP
            svi.additionalInfo = 'up'
            
            // Generate available IPs for this SVI
            svi.availableIPs = generateAvailableIPs(ipMatch[1], ipMatch[2], 50)
          } else if (configLine.includes('description ')) {
            svi.name = configLine.split('description ')[1]
          } else if (configLine === 'no shutdown') {
            svi.additionalInfo = 'up'
          }
        }

        data.svis.push(svi)
      }

      // Ports/Interfaces
      if (line.match(/^interface\s+((?:FastEthernet|GigabitEthernet|TenGigabitEthernet|Ethernet)\d+\/\d+(?:\/\d+)?)/i)) {
        const interfaceName = line.match(/^interface\s+((?:FastEthernet|GigabitEthernet|TenGigabitEthernet|Ethernet)\d+\/\d+(?:\/\d+)?)/i)[1]
        const port = {
          port: interfaceName,
          description: 'N/A',
          configuration: 'N/A',
          status: 'Unknown'
        }

        // Look ahead for port configuration
        for (let j = i + 1; j < lines.length && !lines[j].match(/^interface\s+/) && !lines[j].match(/^!/); j++) {
          const configLine = lines[j].trim()
          
          if (configLine.includes('description ')) {
            port.description = configLine.split('description ')[1]
          } else if (configLine.includes('switchport access vlan ')) {
            port.configuration = `Access VLAN ${configLine.split('switchport access vlan ')[1]}`
          } else if (configLine.includes('switchport trunk')) {
            port.configuration = 'Trunk'
          } else if (configLine.includes('switchport mode trunk')) {
            port.configuration = 'Trunk mode'
          } else if (configLine === 'shutdown') {
            port.status = 'Administratively down'
          } else if (configLine === 'no shutdown') {
            port.status = 'Up'
          }
        }

        data.ports.push(port)
      }

      // OSPF Configuration
      if (line.match(/^router\s+ospf\s+(\d+)/)) {
        inOSPFSection = true
        data.ospf.status = 'Configured'
        data.ospf.details.push(`Process ID: ${line.match(/^router\s+ospf\s+(\d+)/)[1]}`)
      } else if (inOSPFSection && line.match(/^\s*network\s+(\S+)\s+(\S+)\s+area\s+(\S+)/)) {
        const networkMatch = line.match(/^\s*network\s+(\S+)\s+(\S+)\s+area\s+(\S+)/)
        data.ospf.details.push(`Network: ${networkMatch[1]}/${networkMatch[2]} in Area ${networkMatch[3]}`)
      } else if (inOSPFSection && line.match(/^!/)) {
        inOSPFSection = false
      }

      // SNMP Configuration
      if (line.includes('snmp-server')) {
        if (data.snmp.status === 'Not configured') {
          data.snmp.status = 'Configured'
          data.snmp.details = []
        }
        if (line.includes('community ')) {
          const community = line.split('community ')[1].split(' ')[0]
          data.snmp.details.push(`SNMPv3 Group: ${community} (priv)`)
        }
      }

      // Security Features
      if (line.includes('enable password') || line.includes('enable secret')) {
        data.securityPresent.push('Password Encryption: Enabled')
      }
      if (line.includes('aaa ')) {
        data.securityPresent.push('AAA Authentication: Enabled')
      }
      if (line.includes('ssh ')) {
        data.securityPresent.push('SSH Access: Configured for VTY lines')
      }
    }

    return data
  }

  // Helper functions for IP calculations
  const subnetMaskToCIDR = (mask) => {
    const parts = mask.split('.')
    let cidr = 0
    for (const part of parts) {
      const num = parseInt(part)
      cidr += (num >>> 0).toString(2).split('1').length - 1
    }
    return cidr
  }

  const getNetworkAddress = (ip, mask) => {
    const ipParts = ip.split('.').map(Number)
    const maskParts = mask.split('.').map(Number)
    return ipParts.map((part, i) => part & maskParts[i]).join('.')
  }

  const calculateUsableIPs = (cidr) => {
    return Math.pow(2, 32 - cidr) - 2
  }

  const getUsableRange = (ip, mask) => {
    const ipParts = ip.split('.').map(Number)
    const maskParts = mask.split('.').map(Number)
    const network = ipParts.map((part, i) => part & maskParts[i])
    const broadcast = network.map((part, i) => part | (255 - maskParts[i]))
    
    const firstUsable = [...network]
    firstUsable[3] += 1
    const lastUsable = [...broadcast]
    lastUsable[3] -= 1
    
    return `${firstUsable.join('.')} - ${lastUsable.join('.')}`
  }

  const generateAvailableIPs = (ip, mask, maxIPs = 50) => {
    const ipParts = ip.split('.').map(Number)
    const maskParts = mask.split('.').map(Number)
    const network = ipParts.map((part, i) => part & maskParts[i])
    const broadcast = network.map((part, i) => part | (255 - maskParts[i]))
    
    const availableIPs = []
    let currentIP = [...network]
    currentIP[3] += 1 // Start from first usable IP
    
    // Generate IPs up to maxIPs or until we reach broadcast
    while (availableIPs.length < maxIPs) {
      const ipString = currentIP.join('.')
      
      // Check if we've reached the broadcast address
      if (currentIP.every((part, i) => part === broadcast[i])) break
      
      // Skip the interface IP itself
      if (ipString !== ip) {
        availableIPs.push(ipString)
      }
      
      // Increment IP address
      currentIP[3]++
      if (currentIP[3] > 255) {
        currentIP[3] = 0
        currentIP[2]++
        if (currentIP[2] > 255) {
          currentIP[2] = 0
          currentIP[1]++
          if (currentIP[1] > 255) {
            currentIP[1] = 0
            currentIP[0]++
            if (currentIP[0] > 255) break
          }
        }
      }
    }
    
    return availableIPs
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files)
    if (files.length === 0) return

    setIsLoading(true)
    setError('')
    setParsedConfigs([])

    try {
      const configs = []
      for (const file of files) {
        if (!file.name.endsWith('.txt') && !file.name.endsWith('.log')) {
          throw new Error(`Invalid file: ${file.name} must be a .txt or .log file.`)
        }
        
        const text = await file.text()
        const parsedData = parseCiscoConfig(text)
        configs.push({ filename: file.name, data: parsedData })
      }
      
      setParsedConfigs(configs)
      setCurrentPage(0)
    } catch (err) {
      setError(`Error parsing files: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const exportToPDF = () => {
    // PDF export functionality would go here
    alert('PDF export functionality would be implemented here')
  }

  const exportToExcel = () => {
    // Excel export functionality would go here
    alert('Excel export functionality would be implemented here')
  }

  const nextPage = () => {
    if (currentPage < parsedConfigs.length - 1) {
      setCurrentPage(currentPage + 1)
    }
  }

  const prevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1)
    }
  }

  const currentConfig = parsedConfigs[currentPage]

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header with Logo */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <img src={logoImage} alt="Logo" className="cisco-logo" />
          <div>
            <h1 className="text-4xl font-bold text-foreground">Cisco Configuration Parser</h1>
            <p className="text-muted-foreground">Modern tool for parsing and analyzing Cisco switch configurations</p>
          </div>
        </div>
      </div>

      {/* File Upload Section */}
      <Card className="mb-6 cisco-shadow">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Configuration Files
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <label htmlFor="configFile" className="text-sm font-medium">
                Select Cisco config files (.txt or .log):
              </label>
              <input
                ref={fileInputRef}
                type="file"
                id="configFile"
                accept=".txt,.log"
                multiple
                onChange={handleFileUpload}
                className="flex-1 p-2 border border-input rounded-md"
              />
              <Button 
                onClick={() => fileInputRef.current?.click()}
                className="cisco-gradient cisco-hover-lift"
                disabled={isLoading}
              >
                {isLoading ? 'Parsing...' : 'Choose Files'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Navigation and Export */}
      {parsedConfigs.length > 0 && (
        <Card className="mb-6 cisco-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  onClick={prevPage}
                  disabled={currentPage === 0}
                  variant="outline"
                  size="sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <select
                  value={currentPage}
                  onChange={(e) => setCurrentPage(parseInt(e.target.value))}
                  className="p-2 border border-input rounded-md"
                >
                  {parsedConfigs.map((config, index) => (
                    <option key={index} value={index}>
                      {config.filename}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={nextPage}
                  disabled={currentPage === parsedConfigs.length - 1}
                  variant="outline"
                  size="sm"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button onClick={exportToPDF} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
                <Button onClick={exportToExcel} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Analysis */}
      {currentConfig && (
        <Card className="cisco-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Configuration Analysis: {currentConfig.filename}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="general" className="w-full">
              <TabsList className="grid w-full grid-cols-7">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="vlans">VLANs</TabsTrigger>
                <TabsTrigger value="svis">SVIs</TabsTrigger>
                <TabsTrigger value="ports">Ports</TabsTrigger>
                <TabsTrigger value="routing">Routing</TabsTrigger>
                <TabsTrigger value="ospf">OSPF</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>General Device Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div><strong>Hostname:</strong> {currentConfig.data.general.hostname || 'N/A'}</div>
                      <div><strong>OS Version:</strong> {currentConfig.data.general.iosVersion || 'N/A'}</div>
                      <div><strong>Model Number:</strong> {currentConfig.data.general.model || 'N/A'}</div>
                      <div><strong>Serial Number:</strong> {currentConfig.data.general.serialNumber || 'N/A'}</div>
                      <div><strong>MAC Address:</strong> {currentConfig.data.general.macAddress || 'N/A'}</div>
                      <div><strong>Board ID:</strong> {currentConfig.data.general.boardID || 'N/A'}</div>
                      <div><strong>Memory Size:</strong> {currentConfig.data.general.memory || 'N/A'}</div>
                      <div><strong>System Uptime:</strong> {currentConfig.data.general.uptime || 'N/A'}</div>
                      <div><strong>Boot Image:</strong> {currentConfig.data.general.bootImage || 'N/A'}</div>
                      <div><strong>Location:</strong> {currentConfig.data.general.location || 'N/A'}</div>
                      <div><strong>Last Configuration Change:</strong> {currentConfig.data.general.lastChange || 'N/A'}</div>
                      <div><strong>Configuration Size:</strong> {currentConfig.data.general.configSize || 'N/A'}</div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="vlans" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>VLANs and Their Names</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>VLAN ID</TableHead>
                          <TableHead>Name</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentConfig.data.vlans.map((vlan, index) => (
                          <TableRow key={index} className={vlan.id === '1' ? 'font-bold bg-blue-50' : 'cisco-table-row'}>
                            <TableCell>{vlan.id}</TableCell>
                            <TableCell>{vlan.name}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="svis" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>SVIs and IP Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {currentConfig.data.svis.length > 0 ? (
                      <div className="space-y-6">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>SVI</TableHead>
                              <TableHead>VLAN Name</TableHead>
                              <TableHead>IP Address</TableHead>
                              <TableHead>Subnet Mask</TableHead>
                              <TableHead>Network/CIDR</TableHead>
                              <TableHead>Usable Range</TableHead>
                              <TableHead>Free IPs</TableHead>
                              <TableHead>Additional Info</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {currentConfig.data.svis.map((svi, index) => (
                              <TableRow key={index} className="cisco-table-row">
                                <TableCell>Vlan{svi.vlan}</TableCell>
                                <TableCell>{svi.name}</TableCell>
                                <TableCell>{svi.ipAddress}</TableCell>
                                <TableCell>{svi.subnetMask}</TableCell>
                                <TableCell>{svi.networkCIDR}</TableCell>
                                <TableCell>{svi.usableRange}</TableCell>
                                <TableCell>{svi.freeIPs}</TableCell>
                                <TableCell>
                                  <Badge variant={svi.additionalInfo === 'up' ? 'default' : 'secondary'}>
                                    {svi.additionalInfo}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        {/* Available IP Addresses Section */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold">Available IP Addresses</h3>
                          {currentConfig.data.svis
                            .filter(svi => svi.availableIPs && svi.availableIPs.length > 0)
                            .map((svi, index) => (
                              <Card key={index} className="p-4">
                                <h4 className="font-medium mb-3">
                                  Vlan{svi.vlan} ({svi.name}) - {svi.availableIPs.length} Free IPs
                                </h4>
                                <p className="text-sm text-muted-foreground mb-3">
                                  Network: {svi.networkCIDR}
                                </p>
                                <div className="grid grid-cols-8 gap-2">
                                  {svi.availableIPs.map((ip, ipIndex) => (
                                    <div
                                      key={ipIndex}
                                      className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded text-center font-mono"
                                    >
                                      {ip}
                                    </div>
                                  ))}
                                  {svi.freeIPs > svi.availableIPs.length && (
                                    <div className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded text-center">
                                      +{svi.freeIPs - svi.availableIPs.length} more
                                    </div>
                                  )}
                                </div>
                              </Card>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No SVIs configured
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ports" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Port Configurations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {currentConfig.data.ports.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Port</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Configuration</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentConfig.data.ports.map((port, index) => (
                            <TableRow key={index} className="cisco-table-row">
                              <TableCell>{port.port}</TableCell>
                              <TableCell>{port.description}</TableCell>
                              <TableCell>{port.configuration}</TableCell>
                              <TableCell>
                                <Badge variant={port.status === 'Up' ? 'default' : 'secondary'}>
                                  {port.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No port configurations found
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="routing" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Default Gateway and Default Route</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <strong>Default Gateway:</strong> {currentConfig.data.routing.defaultGateway || 'Not configured'}
                      </div>
                      <div>
                        <strong>Default Route:</strong> {currentConfig.data.routing.defaultRoute || 'Not explicitly configured'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ospf" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>OSPF Configuration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <strong>Status:</strong> {currentConfig.data.ospf.status}
                      </div>
                      {currentConfig.data.ospf.details.length > 0 && (
                        <div>
                          <strong>Details:</strong>
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            {currentConfig.data.ospf.details.map((detail, index) => (
                              <li key={index}>{detail}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="security" className="mt-6">
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-green-600">Security Features Present</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {currentConfig.data.securityPresent.length > 0 ? (
                        <ul className="list-disc list-inside space-y-1">
                          {currentConfig.data.securityPresent.map((feature, index) => (
                            <li key={index} className="text-green-600">{feature}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground">No security features detected</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-red-600">Security Features Not Present</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="list-disc list-inside space-y-1">
                        {currentConfig.data.securityMissing.map((feature, index) => (
                          <li key={index} className="text-red-600">{feature}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default App

