# Toyota Internal Lease Calculator

This project is a React application that serves as a lease calculator for Toyota vehicles. It allows users to input lease details and calculates the monthly payments based on the provided information.

## Project Structure

The project is organized as follows:

```
toyota-internal-lease-calculator
├── public
│   └── index.html          # Main HTML file
├── src
│   ├── index.tsx          # Entry point for the React application
│   ├── App.tsx            # Main App component
│   ├── components
│   │   └── LeaseCalculator
│   │       ├── LeaseCalculator.tsx  # Main Lease Calculator component
│   │       ├── LeaseForm.tsx         # Form for inputting lease details
│   │       └── LeaseResults.tsx      # Displays results of lease calculations
│   ├── hooks
│   │   └── useLeaseCalculator.ts      # Custom hooks for lease calculations
│   ├── utils
│   │   └── calculations.ts            # Utility functions for calculations
│   ├── services
│   │   └── api.ts                     # API calls for lease-related data
│   ├── types
│   │   └── index.ts                   # TypeScript types and interfaces
│   ├── styles
│   │   ├── App.css                    # Styles for the main App component
│   │   └── LeaseCalculator.css         # Styles for the Lease Calculator component
│   └── index.css                      # Global styles
├── package.json                       # npm configuration file
├── tsconfig.json                      # TypeScript configuration file
├── .gitignore                         # Files and directories to ignore by Git
└── README.md                          # Documentation for the project
```

## Installation

To set up the project, clone the repository and run the following commands:

```bash
npm install
```

This will install the necessary dependencies:

- react
- react-dom
- typescript
- @types/react
- @types/react-dom
- lucide-react (for icons)
- Any UI component library used in the code (e.g., Tailwind CSS, if applicable)

## Usage

After installing the dependencies, you can start the development server with:

```bash
npm start
```

This will launch the application in your default web browser.

## Contributing

If you would like to contribute to this project, please fork the repository and submit a pull request with your changes.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.