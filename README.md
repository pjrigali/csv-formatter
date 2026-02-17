# CSV Formatter

A simple VS Code extension that views CSV files as formatted HTML tables.

[GitHub Repository](https://github.com/pjrigali/csv-formatter)


## Features

- Opens `.csv` files in a readonly custom editor.
- Formats data into a sortable-looking HTML table (sorting implementation pending).
- Handles quoted fields correctly.
- Handles quoted fields correctly.

## Sample CSV

The extension includes a `sample.csv` file to demonstrate the formatting:

```csv
id,name,role,salary
1,Alice,Engineer,120000
2,Bob,Manager,150000
3,Charlie,Designer,110000
4,Dave,Intern,60000
5,Eve,"Security, Specialist",130000
```

Turns into:


![CSV Table Preview](sample.png)