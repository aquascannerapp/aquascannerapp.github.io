const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5050;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serves HTML files

// Database Configuration
const dbConfig = {
    user: 'sa',            // UPDATE THIS
    password: 'house/fire', // UPDATE THIS
    server: 'aquaerpdb',   
    database: 'ZebraInventoryDB',
    options: {
        encrypt: false, 
        trustServerCertificate: true 
    }
};

// --- API ROUTES ---

// 1. Process Scan (Used by index.html)
app.post('/api/scan', async (req, res) => {
    const { barcode } = req.body;
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        
        // Check if product exists
        const result = await pool.request()
            .input('code', sql.VarChar, barcode)
            .query('SELECT * FROM Products WHERE Barcode = @code');

        if (result.recordset.length > 0) {
            const product = result.recordset[0];
            
            // Log Success
            await pool.request()
                .input('code', sql.VarChar, barcode)
                .input('status', sql.VarChar, 'Success')
                .input('msg', sql.VarChar, `Found: ${product.Name}`)
                .query('INSERT INTO ScanLogs (BarcodeScanned, ScanStatus, Message) VALUES (@code, @status, @msg)');

            res.json({ success: true, product: product });
        } else {
            // Log Not Found
            await pool.request()
                .input('code', sql.VarChar, barcode)
                .input('status', sql.VarChar, 'NotFound')
                .input('msg', sql.VarChar, 'Item not in database')
                .query('INSERT INTO ScanLogs (BarcodeScanned, ScanStatus, Message) VALUES (@code, @status, @msg)');

            res.json({ success: false, message: 'Item Not Found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database Error' });
    } finally {
        if (pool) pool.close();
    }
});

// 2. Get Logs (Used by admin.html)
app.get('/api/logs', async (req, res) => {
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT TOP 50 LogID, BarcodeScanned, ScanStatus, Message, ScanTime 
            FROM ScanLogs ORDER BY ScanTime DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    } finally {
        if (pool) pool.close();
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});