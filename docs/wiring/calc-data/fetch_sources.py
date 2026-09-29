#!/usr/bin/env python3
"""Keep a copy of every web source the K5 master list cites, so audit_citations.py can check it.

Pages are fetched through Firecrawl (never straight from this machine's IP -- ProWire's firewall banned it once,
2026-09-25) one at a time: 20 s between ProWire pages, 10 s elsewhere. Stops at the first 403/429 from a host.
Each page is saved as markdown with a header (url, fetched time, status) to reference_documents/web_snapshots/,
which is gitignored: third-party text never goes into the public repo.

Usage: dotenvx run -- python3 fetch_sources.py [--only substring] [--force]
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[3]
SNAP = REPO / "reference_documents/web_snapshots"

URLS = [
    # contacts, crimp and insertion tooling (the 61-pin and the M130/PDM Superseal plugs)
    "https://www.prowireusa.com/SSC-N",
    "https://www.prowireusa.com/p-1384-k1s-postioner.html",
    "https://www.prowireusa.com/M22520-2-01-afm8-crimp-frame",
    "https://www.digikey.com/en/products/detail/amphenol-aerospace-operations/M39029-56-351/2172799",
    "https://www.digikey.com/en/products/detail/amphenol-aerospace-operations/M39029-58-363/2172809",
    "https://dmctools.com/m39029/contact/196",
    "https://www.dmctools.com/m39029/connector-series/10",
    "https://dmctools.com/k43",
    "https://www.edmo.com/product/M819691410/insert-extraction-tool-red-and-orange-plastic-m819691410",
    "https://www.edmo.com/product/M819691411/insert-extraction-tool-20-gauge-red-and-white-plastic-tips-m819691411",
    # wire and seal fit
    "https://www.prowireusa.com/m22759-32-tefzel-wire.html",
    "https://www.prowireusa.com/m22759-16-tefzel-wire.html",
    "https://www.waytekwire.com/product/aptiv-15366021-gt-150-series-1-way-cable-seal",
    "https://www.waytekwire.com/product/aptiv-12191818-gt-150-series-22-20-ga",
    "https://www.prowireusa.com/p-2061-delphi-15324976-cable-seal-white-metri-pack-150-series.html",
    "https://www.connectorid.com/products/aptiv-15324976",
    "https://www.connectorid.com/products/aptiv-15324974",
    "https://www.customconnectorkits.com/products/15366021",
    "https://www.prowireusa.com/p-506-12110847-female-terminal-18-22-awg.html",
    "https://www.prowireusa.com/p-2268-female-gt-150-terminal-20-22-ga.html",
    "https://www.prowireusa.com/p-3769-20-16-ga-jpt-timer-terminal.html",
    "https://www.prowireusa.com/p-2104-metri-pack-150-280-sealed-crimp-tool.html",
    # plug kits
    "https://www.prowireusa.com/p-2077-ls-crank-map-sensor-connector-kit.html",
    "https://www.prowireusa.com/p-2076-ls-camshaft-sensor-connector-kit.html",
    "https://www.prowireusa.com/p-1753-liquid-temp-sensor-conn-kit.html",
    "https://www.prowireusa.com/p-2069-gm-coil-connector-kit-d585-d581-ls2-7.html",
    "https://www.prowireusa.com/p-3718-8-cyl-injector-connector-kit-w-90-boots.html",
    "https://www.prowireusa.com/68201",
    "https://www.prowireusa.com/p-3845-gt150-6-way-female-housing-dbw.html",
    "https://www.prowireusa.com/p-3846-gt150-6-way-tpa-dbw.html",
    "https://www.ictbillet.com/products/lt-gen-v-throttle-body-connector-component-kit",
    "https://www.ictbillet.com/products/oil-ls3-wire-component-kit",
    "https://www.digikey.com/en/products/detail/amphenol-pcd/M85049-69-25N/5623517",
    "https://www.prowireusa.com/raychem-miniseal-splices",
    "https://www.prowireusa.com/3137ct.html",
    "https://www.prowireusa.com/p-1924-mini-seal-crimp-stub-splice-red.html",
    "https://www.prowireusa.com/p-1925-mini-seal-crimp-stub-splice-blue.html",
    "https://www.prowireusa.com/p-1926-mini-seal-crimp-stub-splice-yellow.html",
    # tools
    "https://www.prowireusa.com/p-2025-ideal-stripmater-tefzel-stripper-26-16-ga.html",
    "https://www.prowireusa.com/p-1233-delphi-gt150-hand-crimp-tool.html",
    "https://www.prowireusa.com/resin-tech-rt125-ds-050-epoxy.html",
    # devices and pinouts
    "https://siemensdeka.com/product/60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm/",
    "https://www.maxxecu.com/webhelp/wirings-e-throttle_bodies.html",
    "https://github.com/rusefi/rusefi/wiki/SENT-ETB-Electronic-Throttle-Body",
    "https://documents.holley.com/199r10762rev1.pdf",
    "https://www.motec.com.au/ac-cc-ethernet/cc-ethernet-dw/",
    # standards and boots
    "https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf",
    "https://www.amphenolpcd.com/wp-content/uploads/2024/03/M85049_69-Shrink-Boot.pdf",
    # 2026-09-27 owner reply: isolator, batteries, DC-DC, Dakota indicators, pedal plug, E-Stopp indicator
    "https://www.bluesea.com/products/7700/ML-RBS_Remote_Battery_Switch_with_Manual_Control_-_12V_DC_500A",
    "https://powerwerx.com/blue-sea-7700-ml-rbs-remote-battery-switch",
    "https://powerwerx.com/victron-ori121236140-oriontrsmart-30a-nonisolated",
    "https://www.ictbillet.com/products/ls-gen-3-truck-dbw-pedal-position-sensor-pigtail",
    "https://www.dakotadigital.com/pdf/GSS-3000.pdf",
    "https://estopp.com/products/esr1-cm",
    "https://estopp.com/pages/how-to",
    "https://estopp.com/pages/faq",
    "https://estopp.com/pages/troubleshooting",
    "https://www.gmsquarebody.com/threads/blower-motor-resistor.5343/",
    "https://www.gmsquarebody.com/threads/ac-blower-wiring.38262/",
    "https://www.usa1industries.com/1985-87-square-body-chevy-gmc-truck-washer-jar-kit/",
    "https://www.usa1industries.com/1985-87-square-body-chevy-gmc-truck-windshield-wiper-washer-pump/",
    "https://www.gmsquarebody.com/threads/general-concensus-on-fixing-the-windshield-washer-pump.26964/",
    # 2026-09-27 carts the owner asked for: audio, windows + locks
    "https://www.crutchfield.com/p_20646CX660/Kicker-46CXA660-5.html",
    "https://www.crutchfield.com/p_109CL1000/JBL-Club-WS1000.html",
    "https://www.crutchfield.com/p_109CL102SL/JBL-Club-102SL.html",
    "https://www.crutchfield.com/p_13698640/JL-Audio-VX700-5i.html",
    "https://www.crutchfield.com/p_13698606/JL-Audio-XD700-5v2.html",
    "https://www.crutchfield.com/p_136C2650X/JL-Audio-C2-650X.html",
    "https://www.crutchfield.com/p_136C3650/JL-Audio-C3-650.html",
    "https://www.crutchfield.com/p_13610TW3/JL-Audio-10TW3-D4.html",
    "https://www.crutchfield.com/p_20646CC654/Kicker-46CSC654.html",
    "https://www.retromanufacturing.com/products/1973-87-chevrolet-c-k-series-trucks-retroradio",
    "https://www.nu-relics.com/73-87-Chevy-Truck-Regulators-p/17383-2.htm",
    "https://classicparts.com/1973-87-retro-radio-hermosa-sku-69-710f-chr-chr",
    "https://shop.autoloc.com/products/compact-2-wire-car-door-lock-actuator-heavy-duty-12-volt-motor-13-lbs-power-12v",
    "https://www.summitracing.com/parts/dak-gss-3000",
    "https://batterysales.com/product/34-78-pc1500dt-odyssey/",
    "https://batterysales.com/product/d34-78-8014-045-optima/",
    "https://www.autoloc.com/catalog/Actuators/Door-Lock-Actuators/AUTZT2000/Compact-2-Wire-Car-Door-Lock-Actuator-Heavy-Duty-12-Volt-Motor-13-Lbs-Power-12V",
    # door pass-throughs re-picked to the window wires' gauge (2026-09-28 night: DTP size 12 for 14 AWG, DT 8-way for the rest)
    "https://www.customconnectorkits.com/products/dtp04-4p",
    "https://www.customconnectorkits.com/products/dt04-08pa",
    # DTM size-20 contacts for the MoTeC LTC power/CAN plug #68054 (WIDEBAND, pin-table pass 2026-09-28)
    "https://www.customconnectorkits.com/products/0462-201-20141",
    "https://www.customconnectorkits.com/products/0460-202-20141",
    # unpicked parts + fuel hanger picks (research 2026-09-28_unpicked-parts-and-fuel-hanger.md)
    "https://www.highflowfuel.com/qfs-performance-bulkhead-connector-fitting-qfs-bkcn-gm/",
    "https://www.highflowfuel.com/quantum-fuel-cell-electrical-bulkhead-fitting-10ga-wire-fuel-pump-assembly-w-teflon-washers/",
    "https://www.highflowfuel.com/qfs-squarebody-1973-1987-ls-lt-swap-an-fitting-fuel-pump-hanger-and-sending-unit-c10-k10-r10-c20-k20-r20-c30-k30-r30-v10-v20-v30/",
    "https://www.ebay.com/itm/163439408565",
    "https://www.aemelectronics.com/products/sensors/pressure_sensors/parts/30-2130-100",
    "https://documents.aemelectronics.com/ebf9109d7d01bb4b636f2da0b8eccda4eb4fb343.pdf",
    "https://www.kartek.com/parts/spal-30107090-plus-series-16-brushless-puller-fan-300w-2053-peak-cfm-drop-in-mount-sits-in-shroud.html",
    "https://www.prowireusa.com/SPAL-BRUSHLESS-FAN-CONNECTOR-KIT-30130628",
    "https://www.championradiators.com/Chevy-pickup-truck-LS-radiator-1973-1987",
    "https://parts.chevrolet.com/product/gm-genuine-parts-air-conditioning-clutch-cycling-switch-15035084",
    "https://www.vintageair.com/hose-kits-fittings/?subcat1=Inline+Safety+Switches&subcat2=Binary+Switch",
    "https://www.summitracing.com/parts/vta-11079-vus",
    "https://torqueking.com/product/30048/qu30048-weather-proof-np205c-transfer-case-indicator-switch/",
    "https://www.oerparts.com/product/1990096.html",
    "https://www.oerparts.com/product/1990084.html",
    "https://www.usa1industries.com/1973-87-square-body-chevy-gmc-truck-headlight-switch/",
    "https://www.motorcityk5.com/i-13220-rear-power-tailgate-window-switch-on-dash-73-91-blazer.html",
    "https://www.bluesea.com/products/1045/12_24V_DC_Dual_USB_Charger_4.8A_with_Intelligent_Device_Recognition",
    "https://www.bluesea.com/products/1011/Dash_Socket_12V_DC_with_Watertight_Cap",
    "https://www.lumiteclighting.com/mini-rail2-led-utility-light-2.html",
    "https://www.truck-lite.com/80251c-1.html",
    "https://www.truck-lite.com/61500r.html",
    "https://www.lmctruck.com/lighting/cab-roof/cc-1973-87-roof-marker-lamp",
    "https://www.bluesea.com/products/1003/CableClam_1.40in",
    "https://www.bluesea.com/products/2003/PowerPost_-_3_8in-16_Stud",
    "https://www.bluesea.com/products/2103/PowerPost_Plus_-_3_8in-16_Stud",
    "https://www.oraclelights.com/products/linear-universal-led-3rd-brake-light-chmsl-module-red",
    # alternate sellers for images refused by classicindustries / bluesea CDNs
    "https://www.camarodepot.ca/oer-1969-2002-chevrolet-pontiac-ignition-switch-tilt-wheel-1990096",
    "https://restorationperformance.com/product/1969-02-amc-gm-ignition-switch-for-models-without-tilt-wheel-2/",
    "https://powerwerx.com/blue-sea-1045-fast-charge-dual-usb-charger-socket-mount",
    "https://www.waytekwire.com/product/blue-sea-systems-1011-12vdc-dash-socket",
    "https://www.westmarine.com/blue-sea-systems-cable-clam-large-1.40inch-35.56mm-max-conn-dia.-0.56inch14.22mm-max-cable-dia.-540757.html",
    "https://www.thornebros.com/products/blue-sea-systems-powerpost-plus-3-8-16-stud-2103",
    "https://www.fisheriessupply.com/blue-sea-systems-12-volt-dash-socket/1011",
    "https://www.heartbeatcitycamaro.com/12718/1969-1970-1971-1972-Camaro-&-Firebird-Ignition-Switch-Without-Tilt-Steering-GM%23-1990084/",
    "https://www.ksvlooms.com/products/mated-dtp-connector-kits-4-way",
    # Packard 56-series terminal gauge sizes (the factory switch blades)
    "https://ceautoelectricsupply.com/product/packard-56-series-female-terminals/",
    # 2026-09-28 DC primary fuse sealing (owner: "the 60a fuse needs to be hella element proofed")
    "https://www.bluesea.com/products/5191/MRBF_Terminal_Fuse_Block_-_30_to_300A",
    "https://www.bluesea.com/products/5191/MRBF_Terminal_Fuse_Block_-_30_to_300A/FAQ",
    "https://www.bluesea.com/products/5178/MRBF_Terminal_Fuse_-_60A",
    "https://www.bluesea.com/products/7720/AMI___MIDI_Safety_Fuse_Block",
    "https://www.bluesea.com/products/category/16/75/Fuse_Blocks/Safety_Fuse_Blocks",
    "https://www.bluesea.com/support/articles/Circuit_Protection/1451/The_Safety_Fuse_Blocks_[AMI_MIDI_and_MEGA_AMG]",
    "https://www.littelfuse.com/products/fuses-overcurrent-protection/fuse-holders-fuse-blocks-accessories/fuse-holders/bolt-down-single-fuse-holders/mega-sn/880014175",
    "https://www.littelfuse.com/assetdocs/mega-sn-datasheet?assetguid=088cbd6a-284f-4b0e-933e-dbfdc633db13",
    "https://www.littelfuse.com/products/fuses-overcurrent-protection/fuse-holders-fuse-blocks-accessories/fuse-holders/bolt-down-single-fuse-holders/1-way-sealed-midi-holder-48v",
    "https://www.littelfuse.com/products/fuses-overcurrent-protection/fuse-holders-fuse-blocks-accessories/fuse-holders/bolt-down-single-fuse-holders/midi-498",
    "https://ceautoelectricsupply.com/product/eaton-mrbf-single-fuse-holder-kit/",
    "https://www.bluesea.com/products/7721/AMG_Safety_Fuse_Block",
    # tailgate (rear) window regulator + motor + glass sourcing, 73-91 Blazer (2026-09-28)
    "https://www.nu-relics.com/73-91-Chevy-Blazer-Jimmy-Tailgate-Regulator-p/17383-1.htm",
    "https://www.usa1industries.com/1973-91-square-body-chevy-gmc-blazer-tailgate-window-regulator-heavy-duty-power/",
    "https://www.lmctruck.com/body-components/bed-tailgate/csb-1973-91-tailgate-and-components_with-removable-hardtop",
    "https://www.carolinaclassictrucks.com/73-91-GM-Electric-Regulators.html",
    "https://k5squared.com/products/nu-relics-1973-1991-blazer-jimmy-tailgate-17383-1-regulator-motor-no-switches-1/",
    "https://ck5.com/forums/threads/rear-power-window-motor-upgrade.349102/",
    # lamp sockets + LED bulbs + sealed sockets, 73-87 C/K (research 2026-09-28, docs/wiring/research/2026-09-28_lamp-sockets-led-sealed.md)
    "https://www.gmsquarebody.com/threads/park-and-tail-light-sockets.14528/",
    "https://upcarparts.com/products/3-wire-tail-light-turn-signal-socket-1973-1991-chevrolet-gmc-trucks",
    "https://jlfabrication.com/products/73-87-chevy-gmc-truck-tail-light-socket-park-light-round-headlight-with-pigtail",
    "https://www.repairconnector.com/categories/LAMP-SOCKET-ASSEMBLIES/GM-LAMP-SOCKETS/",
    "https://memotronics.com/park-stop-tail-light-socket-connector-for-gm-8903202-8914822-qty-5/",
    "https://www.yoyopart.com/oem/12295401/gm-6294015.html",
    "https://www.diodedynamics.com/1157-xp80-tail-light-led-bulbs.html",
    "https://www.diodedynamics.com/1157-xp80-turn-signal-led-bulbs.html",
    "https://www.diodedynamics.com/1156-xpr-backup-led-bulbs.html",
    "https://www.diodedynamics.com/194-hp5-led-bulbs.html",
    "https://www.sylvania-automotive.com/sylvania-1157r-red-zevo-led-mini-2-pack/1157RLED.BP2.html",
    "https://www.usa.philips.com/c-p/1157RULRX2/ultinon-led-car-signaling-bulb",
    "https://www.diodedynamics.com/41mm-hp6-led-bulbs.html",
    "https://www.farnell.com/datasheets/628276.pdf",
    "https://www.customconnectorkits.com/products/dt06-3s",
    "https://www.customconnectorkits.com/products/dt04-3p",
    "https://www.customconnectorkits.com/products/dt06-2s",
    "https://www.customconnectorkits.com/products/dt04-2p",
    "https://www.269motorsports.com/wire-harnesses-adapters/side-marker-light-bulb-socket-fits-194-194a-t10-168-t15-fits-gm-chevrolet-qty-2/",
    "https://www.usa1industries.com/1973-87-square-body-chevy-gmc-truck-side-marker-lamp-socket-w-pigtail/",
    "https://www.truck-lite.com/products/harness/sockets.html",
    "https://ck5.com/forums/threads/led-equivalent-to-67-bulb.335186/",
    "https://www.classicindustries.com/shop/all-years/chevrolet/truck/parts/lighting/tail-lamps/tail-lamp-wiring-pigtails/",
    "https://www.lmctruck.com/lighting/tail-light/cc-1973-87-tail-light-fleetside",
    "https://www.diodedynamics.com/1156-hp11-backup-led-bulbs.html",
    "https://dynamicappearance.com/shop-by-bulb/41mm-578-212-2/",
    # iBooster Gen 2 deep dive (research 2026-09-28_ibooster-gen2-wiring.md)
    "https://openinverter.org/wiki/Bosch_iBooster",
    "https://www.fastandquiet.com/downloadable/bosch-ibooster-gen-2-pinout.PDF",
    "https://tulayswirewerks.com/product/bosch-ibooster-gen-2-connector-kit/",
    "https://www.evcreate.com/installing-the-ibooster/",
    "https://irate4x4.com/threads/ibooster-electric-brake-booster.394316/page-15",
    "https://www.bosch-mobility.com/en/solutions/driving-safety/ibooster/",
    "https://irate4x4.com/threads/ibooster-electric-brake-booster.394316/page-17",
    "https://openinverter.org/forum/viewtopic.php?t=5925",
    "https://www.bosch-mobility.com/en/solutions/driving-safety/brake-booster/",
    "https://www.evcreate.com/ibooster-can-bus/",
    "https://service.tesla.com/docs/ModelY/ServiceManual/en-us/GUID-0CE8F156-928A-4338-A693-CF6EEB9055E6.html",
    "https://www.evcreate.com/ibooster-donor-vehicles/",
    "https://www.bosch-mobility.com/media/global/solutions/passenger-cars-and-light-commercial-vehicles/driving-safety-systems/brake-booster/ibooster/summary-ibooster.pdf",
    # 6L90 transmission case connector and the PCS TCM-2650 (research/2026-09-28_6l90-transmission-electrical.md)
    "https://www.eficonnection.com/home/product/6l80e-6l90e-t43-tcm-transmission-connector-pigtail",
    "https://www.zerogravityperformance.com/product/tcm-2650-gm-6l50e-6l80e-6l90e-transmission-harness/",
    "https://www.psiconversion.com/products/pcm-programming/transmissioncontrollers/TCM-2650.html",
    "https://monstertransmission.com/blogs/news/6l80-6l90-tehcm-guide-common-failures-year-differences-tag-id-reference",
    # iBooster controller reverse-engineering (query URLs are snapshotted with the query in the filename)
    "https://sghinnovations.com/product/ibooster-controller-ecu-gen2/",
    "https://openinverter.org/forum/viewtopic.php?p=82361",
    "https://raw.githubusercontent.com/joshwardell/model3dbc/master/Model3CAN.dbc",
    "https://openinverter.org/forum/viewtopic.php?t=2762",
    "https://www.diyelectriccar.com/threads/not-all-gen2-ibooster-appear-equal.211462/",
    "https://sghinnovations.com/product/ibooster-controller-ecu/",
    # our unit is Tesla Model S Gen 1 (1037123-00-B, Calimotive order #1011, 2023-11-09)
    "https://www.fastandquiet.com/downloadable/bosch-ibooster-gen-1-pinout.PDF",
    "https://tulayswirewerks.com/product/bosch-ibooster-gen-1-universal-wire-harness/",
    "https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/tesla_can.dbc",
    # door, mirror, camera and lighting add-ons (research/2026-09-30_door-mirror-camera-lighting-options.md, fetched 2026-09-29)
    "https://www.rearviewsafety.com/license-plate-backup-camera-system-rvs-7180355-ir.html",
    "https://www.rearviewsafety.com/oem-rear-view-replacement-mirror-monitor.html",
    "https://www.rearviewsafety.com/inview-360-hd-around-vehicle-monitoring-systems-rvs-01-360.html",
    "https://catalog.echomaster.com/catalog/universal-solutions/pcam-bs1",
    "https://catalog.echomaster.com/index.php?controller=attachment&id_attachment=2113",
    "https://catalog.echomaster.com/catalog/ahd-cameras/phd5n1",
    "https://catalog.echomaster.com/catalog/lane-change-assistance/fc-gmld103-mc",
    "https://service.tesla.com/docs/Model3/ServiceManual/2024/en-us/GUID-E473ED74-9C48-4106-936F-C6A8806AAF5B.html",
    "https://teslamotorsclub.com/tmc/threads/tesla-fender-camera-output.301521/",
    "https://www.notebookcheck.net/Tesla-HW4-vs-HW3-side-indicator-design-and-specs-comparison-shows-it-can-t-be-retrofit.726575.0.html",
    "https://rydeenmobile.com/product/bss2lpb/",
    "https://rydeenmobile.com/product/bss3-microwave-radar-blindspot-detection-system/",
    "https://rydeenmobile.com/wp-content/uploads/BSS1-Instruction-Manual-1.pdf",
    "https://www.sensata.com/products/blind-spot-monitoring-systems/preview-side-defender-ii",
    "https://www.sensata.com/sites/default/files/a/preview-side-defender-II-user-manual.pdf",
    "https://www.grote.com/signal-lighting/clearance-marker-lights/micronova-dot-led-clearance-marker-lights/49343/",
    "https://www.grote.com/signal-lighting/clearance-marker-lights/micronova-led-clearance-marker-lights/47973/",
    "https://boostautoparts.com/products/t1sog",
    "https://www.apexlighting.com/boat-lights/courtesy-lights/echo-flush-mount-led-courtesy-light/",
    "https://undergroundlighting.com/collections/led-puddle-lights",
    "https://www.chevypartspros.com/sku/84408372.html",
    "https://www.trucklightparts.com/truck-lite-60094y.html",
    "https://centrevilletrailer.com/product/truck-lite-10-series-25-amber-round-low-profile-grommet-mount-led-clearancemarker-light/",
    "https://www.lmctruck.com/bumpers/custom-bumper/cc-1973-87-custom-chrome-front-bumper-lighted",
    "https://www.lmctruck.com/1973-91-chevy-gmc/csb-1973-91-bumper-brace-kits-and-bumper-bolt-kits",
    "https://fleetsafe.com.au/wp-content/uploads/2024/03/Mobileye-8-Connect%E2%84%A2-Technical-Installation-Guide-4G-v3.0.pdf",
    "https://catalog.archive.pac-audio.com/catalog/camera-switchers/vs41",
    "https://catalog.archive.pac-audio.com/index.php?controller=attachment&id_attachment=894",
    "https://www.sonicelectronix.com/item-123401-PAC-VS41.html",
    "https://www.brandmotion.com/product/fullvue-mirror-vision-system/",
    "https://www.ringbrothers.com/gentex-gntx-r-auto-dimming-rearview-mirror-black",
    "https://protouringstore.com/products/billet-mirrors-for-1973-1987-squarebody-chevy-trucks",
    "https://protouringstore.com/products/billet-mirrors-for-1973-1987-squarebody-chevy-trucks.js",
    "https://www.intekotto.com/exterior-mirrors",
    "https://www.bbtfabrications.com/cnc-machining-and-custom-hot-rod-parts",
    "https://azproperformance.com/products/interk-otto-classic-rectangle-mirrors-csrms",
    "https://www.ringbrothers.com/mirrors",
    "https://www.ringbrothers.com/universal-truck-rectangular-mirror",
    "https://www.summitracing.com/parts/rgb-92000-2200-b",
    "https://eddiemotorsports.com/products/kinetic-square-mirror",
    "https://www.billetrides.com/product/universal-truck-gm-73-87",
    "https://www.lmctruck.com/mirrors/door/cc-1973-87-gm-style-reproduction-door-mirror",
    "https://www.autometaldirect.com/door-mirror---chrome---small-style---lh-or-rh---73-91-chevy-gmc-ck-squarebody-truck",
    "https://www.gmsquarebody.com/threads/door-mirror-mount.19400/",
    "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-571/subpart-B/section-571.111",
    "https://fabcon.com/articles/precision-cnc-machining/cnc-machining-hourly-rate-us/",
    "https://3space.com/how-much-does-3d-scanning-cost/",
    "https://www.rostra.com/backzone-truck-parking-sensor-system.php",
    "https://www.lmctruck.com/electrical/wiper-components/cc-1973-84-windshield-wiper-and-washer",
    "https://www.classicparts.com/1973-84-Windshield-Washer-Hose-Kit/productinfo/67-865/",
    "https://www.ebay.com/itm/192684099994",
    "https://ck5.com/forums/threads/tech-detailed-wiper-wiring-diagram.174785/",
    # fuel system and regulator (research 2026-09-30_fuel-system-and-regulator.md); the regulator and rail instruction PDFs
    # sit behind hashed links on these two product pages, so their text copies are saved by hand (research doc, sources)
    "https://aeromotiveinc.com/products/new-a1000-gen-ii-efi-regulator",
    "https://www.holley.com/products/fuel_systems/fuel_rails/parts/534-209",
    "https://aeromotiveinc.com/products/bracket-for-aeromotive-13138-13139-and-13140-ls-fuel-regulators",
    "https://www.milspecwiring.com/assets/images/GPR_M1_Package.pdf",
    "https://assets.motec.com.au/strapi/M1_Flex_Fuel_User_Guide_249c316b37.pdf",
    "https://assets.motec.com.au/strapi/M1_To_PDM_CAN_Messaging_fd06806969.pdf",
    "https://moteconline.motec.com.au/Package/ViewVariant?PackageVariantId=2081",
    "https://www.motec.com.au/products/GPR?catId=15",
    "https://www.motec.com.au/products/Water%20Temperature%20Sensor",
    # wheel speed sensors, tone rings, knuckle mounts (research/2026-09-30_wheel-speed-sensors.md)
    "https://www.motec.com.au/products/GPR",
    "https://www.motec.com.au/products/E888",
    "https://assets.motec.com.au/strapi/E888_E816_User_Manual_814183344d.pdf",
    "https://assets.motec.com.au/strapi/WD_14007_E888_Wiring_Diagram_aa73efe4c4.pdf",
    "https://assets.motec.com.au/strapi/M1_Launch_Control_User_Guide_4d1e40932b.pdf",
    "https://motec.zendesk.com/hc/en-gb/articles/14594472064015-Checklist-Wheel-Speed-Setup",
    "https://motec.zendesk.com/hc/en-gb/community/posts/16900136044559-Driven-wheel-speed",
    "https://motec.zendesk.com/hc/en-gb/community/posts/16900168693007-M1-Wheel-speed-vehicle-speed-settings",
    "https://motec.zendesk.com/hc/en-gb/community/posts/16899812108303-M800-wheel-speed-sensors",
    "https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/7165/85_GS10050.pdf",
    "https://www.digikey.com/en/products/detail/zf-electronics/GS100502/361998",
    "https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/5657/55505_10-16-15.pdf",
    "https://www.digikey.com/en/products/detail/littelfuse-inc/55505-00-02-A/1237226",
    "https://www.bosch-motorsport.com/products/sensors/speed/speed-sensor-hall-effect-ha-m/",
    "https://www.bosch-motorsport.com/media/catalog_content/downloads_catalog/pdf_catalog/basic_information_speedsensors.pdf",
    "https://www.bosch-motorsport.com/products/brake/antilock-braking-systems-abs/abs-m5-kit/",
    "https://www.customconnectorkits.com/products/dtm04-3p",
    "https://www.customconnectorkits.com/products/dtm06-3s",
]


def stem(url):
    u = urlparse(url)
    last = [p for p in u.path.split("/") if p][-1] if u.path.strip("/") else "index"
    last = re.sub(r"\.(html?|pdf)$", "", last)
    # a query URL keeps its query after a double underscore, so two attachments on one path don't share a file
    # (the existing openinverter.org__viewtopic.php__p=82361.md naming)
    return f"{u.netloc}__{last}" + (f"__{u.query}" if u.query else "")


def scrape(url, key):
    body = json.dumps({"url": url, "formats": ["markdown"], "onlyMainContent": False, "timeout": 60000}).encode()
    req = urllib.request.Request("https://api.firecrawl.dev/v1/scrape", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        sys.exit("FIRECRAWL_API_KEY not set (run under dotenvx)")
    SNAP.mkdir(parents=True, exist_ok=True)
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    force = "--force" in sys.argv
    blocked, last_host_at = set(), {}
    for url in URLS:
        if only and only not in url:
            continue
        host = urlparse(url).netloc
        out = SNAP / f"{stem(url)}.md"
        if out.exists() and not force:
            print(f"have  {out.name}")
            continue
        if host in blocked:
            print(f"skip  {url} (host blocked this run)")
            continue
        gap = 20 if "prowireusa" in host else 10      # owner rule: one request per host every 10 s, ProWire every 20 s
        wait = last_host_at.get(host, 0) + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            res = scrape(url, key)
        except Exception as e:  # network or API error: record and move on
            print(f"FAIL  {url}: {e}")
            last_host_at[host] = time.time()
            continue
        last_host_at[host] = time.time()
        meta = (res.get("data") or {}).get("metadata") or {}
        status = meta.get("statusCode")
        md = (res.get("data") or {}).get("markdown") or ""
        if status in (403, 429):
            blocked.add(host)
            print(f"STOP  {host} answered {status}; no more requests to it this run")
            continue
        if not res.get("success") or not md.strip() or (status or 200) >= 400:
            print(f"EMPTY {url} (status {status})")
            continue
        head = (f"<!-- source: {url}\n     fetched: {datetime.now(timezone.utc).isoformat(timespec='seconds')} via Firecrawl\n"
                f"     status: {status} · title: {meta.get('title', '')} -->\n\n")
        out.write_text(head + md)
        print(f"saved {out.name} ({len(md):,} chars, status {status})")


if __name__ == "__main__":
    main()
