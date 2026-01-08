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
app.use(express.static(path.join(__dirname, 'public'))); 

// --- DATABASE 1: LOCAL APP DB (For Logging Scans) ---
// Connects to: localhost\ZebraInventoryDB
const dbConfigLogs = {
    user: 'sa',            
    password: 'house/fire', 
    server: 'aquaerpdb',   
    database: 'ZebraInventoryDB',
   options: { 
        encrypt: false, 
        trustServerCertificate: true,
        useUTC: false // <--- FIXED: Prevents 6-hour timezone offset
    }
};

// --- DATABASE 2: EPICOR LIVE DB (For Reading Orders) ---
// Connects to: aquaerpdb\EpicorLiveDB
const dbConfigEpicor = {
    user: 'odbcuser',            
    password: 'odbcuser', 
    server: 'aquaerpdb',   
    database: 'Epicor10Live', 
    options: { 
        encrypt: false, 
        trustServerCertificate: true,
        useUTC: false // <--- FIXED: Ensures dates read correctly
    }
};

// --- ROUTES ---

// 1. Get Jobs
app.get('/api/jobs/:orderNum', async (req, res) => {
    const orderNum = req.params.orderNum;
    let pool;
    try {
        pool = await sql.connect(dbConfigEpicor); 
        const result = await pool.request()
            .input('OrderNum', sql.Int, orderNum)
            .query(`
                SELECT DISTINCT JobNum 
                FROM [Epicor10Live].[dbo].[MasterPackingSlipViewFinal]
                WHERE Company = 'DD-1' 
                  AND OrderNum = @OrderNum 
                  AND JobNum IS NOT NULL
                ORDER BY JobNum
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset });
        } else {
            res.json({ success: false, message: 'No Jobs found (DD-1).' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'DB Error' });
    } finally {
        if (pool) pool.close();
    }
});

// 2. Get Pick List
app.get('/api/picklist/:orderNum/:jobNum', async (req, res) => {
    const { orderNum, jobNum } = req.params;
    let pool;
    try {
        pool = await sql.connect(dbConfigEpicor); 
        const result = await pool.request()
            .input('OrderNum', sql.Int, orderNum)
            .input('JobNum', sql.VarChar, jobNum)
            .query(`
                SELECT 
                    V.Company, V.OrderNum, V.detPartNum AS PartNum, 
                    V.OrderLine, V.LineDesc, V.AssemblySeq, V.MtlSeq, V.JobNum, 
                    J.IssuedQty, J.RequiredQty, V.detDescription, J.ReqDate
                FROM [Epicor10Live].[dbo].[MasterPackingSlipViewFinal] AS V
                INNER JOIN [Epicor10Live].[dbo].JobMtl AS J
                    ON V.JobNum = J.JobNum 
                    AND V.AssemblySeq = J.AssemblySeq 
                    AND V.MtlSeq = J.MtlSeq 
                    AND V.Company = J.Company
                WHERE (V.Company = 'DD-1') 
                  AND (V.OrderNum = @OrderNum) 
                  AND (V.JobNum = @JobNum) 
                  AND (V.detPartNum IS NOT NULL)
                  AND ( (V.shipparts = 1) OR (V.shipAsm = 1) )
                ORDER BY V.AssemblySeq, V.MtlSeq
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset });
        } else {
            res.json({ success: false, message: 'No parts found.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'DB Error' });
    } finally {
        if (pool) pool.close();
    }
});

// 3. Save Log (Updated for Quantity)
app.post('/api/log', async (req, res) => {
    const { barcode, status, message, selectedQty } = req.body;
    
    // Append Quantity to message if it exists
    let finalMessage = message;
    if (selectedQty && status === 'Success') {
        finalMessage += ` | Qty: ${selectedQty}`;
    }

    let pool;
    try {
        pool = await sql.connect(dbConfigLogs);
        await pool.request()
            .input('code', sql.VarChar, barcode)
            .input('status', sql.VarChar, status)
            .input('msg', sql.VarChar, finalMessage)
            .query('INSERT INTO ScanLogs (BarcodeScanned, ScanStatus, Message) VALUES (@code, @status, @msg)');
        
        res.json({ success: true });
    } catch (err) {
        console.error("Log Error:", err);
        res.status(500).send("Log Failed"); 
    } finally {
        if (pool) pool.close();
    }
});

// 4. Get Logs
app.get('/api/logs', async (req, res) => {
    let pool;
    try {
        pool = await sql.connect(dbConfigLogs);
        const result = await pool.request().query(`
            SELECT TOP 50 LogID, BarcodeScanned, ScanStatus, Message, ScanTime 
            FROM ScanLogs ORDER BY ScanTime DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'DB Error' });
    } finally {
        if (pool) pool.close();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});