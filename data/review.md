# Cleanup review

Generated 2026-10-06 16:19 from `EquipmentList.xlsx`. 137 items (90 active). Fix anything wrong here in the Google Sheet after import (or in `scripts/clean_inventory.py` and rerun).


## Proposed codes (row had no Code Name) (23)

- **3DP12**: row 95: Metal 3D Printer Open Additive PANDA 11
- **AC8**: row 96: 3-axis accelerometer PCB 356A44
- **3DP13**: row 97: 3D printer Creality Ender 3 Pro
- **3DP14**: row 98: 3D printer Creality Ender 3 Pro
- **3DP15**: row 99: 3D printer Creality Ender 3 Pro
- **3DP16**: row 100: 3D printer Creality Ender 3 Pro
- **3DP17**: row 101: 3D printer Creality Ender 3 Pro
- **3DP18**: row 102: 3D printer Creality Ender 3 Pro
- **3DP19**: row 103: 3D printer BambuLab X1C
- **FS1**: row 104: (no description) PCB 208C03
- **SCN1**: row 105: 3D Object Scanner Wiiboox Reeyee SP
- **PF1**: row 106: Push-on Fitting Exotic W68PLP-8-4
- **THG1**: row 107: Thermal-Hygrometer Govee H5075
- **ND1**: row 109: Nitrogen Dewar Cryogenic Gases "240" 2.2 UN1977
- **DT1**: row 110: Digital Thermometer Gain Express 68022_2P
- **PB1**: row 111: Portable Photo Studio Box Slow Dolphin
- **HSC1**: row 112: High Speed Camera Kron Technologies Chronos 2.1-HD
- **LN1**: row 113: Lens Sigma 24-70mm f/2.8 DG OS HSM Art Lens
- **3DP20**: row 115: 3D Printer Creality Ender 5
- **3DP21**: row 116: 3D Printer Creality Ender 5
- **RA1**: row 117: Robot Arm Flexiv
- **RA2**: row 118: Robot Arm Universal Robots UR5
- **DR1**: row 119: Dremel

## Descriptions filled in or corrected (7)

- **LT3**: Description set to 'Laptop': was "Manual Stage", but brand/model is HP Zbook15 (same as LT2)
- **MA3**: Description set to 'Manual Stage': blank; ThorLabs DTS25/M like MA1/MA2
- **AC7**: Description set to 'Accelerometer': blank; guessed from AC code and PCB brand
- **M2**: Description set to 'Monitor': blank; guessed from M code (M1 is a Dell monitor)
- **M3**: Description set to 'Monitor': blank; guessed from M code (M1 is a Dell monitor)
- **M4**: Description set to 'Monitor': blank, unopened; guessed from M code
- **FS1**: Description set to 'Force sensor': blank; PCB 208C03 is an ICP force sensor

## Duplicate serial numbers (1)

- **MD6 / MD8**: both have S/N R-1126-00009; one is probably a copy-paste error

## Possible duplicate entries (2)

- **3DP20 / 3DP21**: Creality Ender 5 rows with no code, on the wood table; may be 3DP6 / 3DP9 (also Ender 5, listed as retiring) rather than new printers
- **PF1 / ND1**: also listed on the PANDA sheet (supplier list), may not need tracking here

## Assumed checked out to a person (2)

- **BS1**: location column holds uniqname, set Holder = chq@umich.edu (after move: chq; before move: to long term storage; original: Cabinet 2, 3rd shelf)
- **DT1**: location column holds uniqname, set Holder = yuehlint@umich.edu (after move: talk to Tao; original: yuehlint)

## Active but no home location (5)

- **DT1**: after move: talk to Tao; original: yuehlint
- **HSC1**: after move: PANDA space?; before move: Newly Purchased
- **LN1**: after move: PANDA space?; before move: Newly Purchased
- **LSG1**: after move: talk to Conor; before move: Newly Purchased; original: conors
- **LABEL1**: no location at all

## Condition normalized to unknown (3)

- **HA6**: original was "missing?"
- **MC1**: original was "working?"
- **ASR1100**: original was "unkown"

## Marked inactive (cannot be checked out) (47)

- **3DP1** 3D Printer: marked retiring/retired
- **3DP10** 3D Printer: not found in 1100 Dow
- **3DP11** 3D Printer: marked retiring/retired
- **3DP2** 3D Printer: marked retiring/retired
- **3DP3** 3D Printer: marked retiring/retired
- **3DP4** 3D Printer: marked retiring/retired
- **3DP5** 3D Printer: marked retiring/retired
- **3DP6** 3D Printer: marked retiring/retired
- **3DP7** 3D Printer: marked retiring/retired
- **3DP8** 3D Printer: not found in 1100 Dow
- **3DP9** 3D Printer: marked retiring/retired
- **CD1** Cordless Drill: marked retiring/retired
- **CR1** NI Rio Controller: not found in 1100 Dow
- **DC1** Digital Calipers: not found in 1100 Dow
- **DC2** Digital Calipers: not found in 1100 Dow
- **DC3** Digital Calipers: not found in 1100 Dow
- **HA6** Impact hammer: not found in 1100 Dow
- **LS1** Laser Triangulation Sensor: not found in 1100 Dow
- **MA1** Manual Stage: not found in 1100 Dow
- **MA2** Manual Stage: not found in 1100 Dow
- **MA3** Manual Stage: not found in 1100 Dow
- **MD11** Motor drive: not found in 1100 Dow
- **MD12** PWM Motor Drive: not found in 1100 Dow
- **MD13** PWM Motor Drive: not found in 1100 Dow
- **MD7** Linear Motor Drive: not found in 1100 Dow
- **MD9** Motor Drive Rack: not found in 1100 Dow
- **MS1** Magnetic Stand for Digimatic Indicator: not found in 1100 Dow
- **OS1** Oscilloscope: not found in 1100 Dow
- **PJT** Projector: not found in 1100 Dow
- **PR1** Powered air respirator: not found in 1100 Dow
- **PR2** Powered air respirator: not found in 1100 Dow
- **PS1** Power supply: not found in 1100 Dow
- **RBH1** Respirator hat: not found in 1100 Dow
- **RBH2** Respirator hat: not found in 1100 Dow
- **SS2** Third Hand: not found in 1100 Dow
- **SS3** General Duty Safety Switch: not found in 1100 Dow
- **TH1** T link hood: not found in 1100 Dow
- **TH2** T link hood: not found in 1100 Dow
- **3DP13** 3D printer: marked retiring/retired
- **3DP14** 3D printer: marked retiring/retired
- **3DP15** 3D printer: marked retiring/retired
- **3DP16** 3D printer: marked retiring/retired
- **3DP17** 3D printer: marked retiring/retired
- **3DP18** 3D printer: marked retiring/retired
- **SCN1** 3D Object Scanner: marked retiring/retired
- **PF1** Push-on Fitting: not found in 1100 Dow
- **PB1** Portable Photo Studio Box: not found in 1100 Dow
