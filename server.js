const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5050;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE CONFIGURATION ---
const dbConfigLogs = {
    user: 'sa',
    password: 'house/fire', 
    server: 'aquaerpdb',
    database: 'ZebraInventoryDB',
    options: { encrypt: false, trustServerCertificate: true, useUTC: false },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

const dbConfigEpicor = {
    user: 'odbcuser',
    password: 'odbcuser', 
    server: 'aquaerpdb',
    database: 'Epicor10Live',
    options: { encrypt: false, trustServerCertificate: true, useUTC: false },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

// --- GLOBAL CONNECTION POOLS ---
const poolLogs = new sql.ConnectionPool(dbConfigLogs);
const poolEpicor = new sql.ConnectionPool(dbConfigEpicor);

const poolLogsConnect = poolLogs.connect();
const poolEpicorConnect = poolEpicor.connect();

// Ensure connections are ready & log errors
poolLogs.on('error', err => console.error('Logs DB Pool Error:', err));
poolEpicor.on('error', err => console.error('Epicor DB Pool Error:', err));


// --- ROUTES ---

// 1. Get Jobs
app.get('/api/jobs/:orderNum', async (req, res) => {
    try {
        await poolEpicorConnect; 
        const result = await poolEpicor.request()
            .input('OrderNum', sql.Int, req.params.orderNum)
            .query(`SELECT DISTINCT JobNum FROM [Epicor10Live].[dbo].[MasterPackingSlipViewFinal] WHERE Company='DD-1' AND OrderNum=@OrderNum AND JobNum IS NOT NULL ORDER BY JobNum`);

        if (result.recordset.length > 0) res.json({ success: true, data: result.recordset });
        else res.json({ success: false, message: 'No Jobs found.' });
    } catch (err) {
        console.error("Jobs Error:", err);
        res.status(500).json({ success: false, message: 'DB Error' });
    }
});

// 2. Get Pick List (FIXED LOGIC)
app.get('/api/picklist/:orderNum/:jobNum', async (req, res) => {
    try {
        await poolEpicorConnect;
        await poolLogsConnect;

        // A. Fetch ERP Data
        const erpRes = await poolEpicor.request()
            .input('OrderNum', sql.Int, req.params.orderNum)
            .input('JobNum', sql.VarChar, req.params.jobNum)
            .query(`
                SELECT V.Company, V.OrderNum, V.detPartNum AS PartNum, V.OrderLine, V.LineDesc, V.AssemblySeq, V.MtlSeq, V.JobNum, 
                J.IssuedQty, J.RequiredQty, V.detDescription
                FROM [Epicor10Live].[dbo].[MasterPackingSlipViewFinal] AS V
                INNER JOIN [Epicor10Live].[dbo].JobMtl AS J ON V.JobNum=J.JobNum AND V.AssemblySeq=J.AssemblySeq AND V.MtlSeq=J.MtlSeq 
                WHERE V.Company='DD-1' AND V.OrderNum=@OrderNum AND V.JobNum=@JobNum AND V.detPartNum IS NOT NULL AND (V.shipparts=1 OR V.shipAsm=1)
                ORDER BY V.AssemblySeq, V.MtlSeq
            `);

        if (erpRes.recordset.length === 0) return res.json({ success: false, message: 'No parts found.' });

        // B. Fetch Logs
        const logRes = await poolLogs.request()
            .input('jobSearch', sql.VarChar, `%Job:${req.params.jobNum}%`)
            .query("SELECT BarcodeScanned, Message FROM ScanLogs WHERE Message LIKE @jobSearch AND ScanStatus = 'Success'");

        const pickedMap = {};
        
        logRes.recordset.forEach(log => {
            // FIX: Use BarcodeScanned (A...~S...~...) to identify the unique line item
            // Structure: A{AssemblySeq}~S{MtlSeq}~{PartNum}
            // We use Regex to extract AssemblySeq and MtlSeq safely
            const barcodeMatch = log.BarcodeScanned ? log.BarcodeScanned.match(/^A(\d+)~S(\d+)~/) : null;
            
            // We still parse the Message to get the picked Qty
            const qtyMatch = log.Message.match(/Qty:\s*([\d\.]+)/);
            
            if (barcodeMatch && qtyMatch) {
                const asm = parseInt(barcodeMatch[1]); // AssemblySeq
                const mtl = parseInt(barcodeMatch[2]); // MtlSeq
                const qty = parseFloat(qtyMatch[1]);   // Quantity Picked

                // Create a unique key for this specific line
                const uniqueKey = `${asm}-${mtl}`;
                
                pickedMap[uniqueKey] = (pickedMap[uniqueKey] || 0) + qty;
            }
        });

        // C. Combine (Using Unique Key)
        erpRes.recordset.forEach(part => {
            const uniqueKey = `${part.AssemblySeq}-${part.MtlSeq}`;
            const picked = pickedMap[uniqueKey] || 0;
            
            // Send the specific picked quantity back to UI
            part.PickedQty = picked; 
            
            // Calculate Remaining using: REQ - (ISSUED + LOGS)
            part.RemainingQty = Math.max(0, part.RequiredQty - (part.IssuedQty + picked));
        });

        res.json({ success: true, data: erpRes.recordset });

    } catch (err) {
        console.error("Picklist Error:", err);
        res.status(500).json({ success: false, message: 'DB Error' });
    }
});

// 3. Log Scan
app.post('/api/log', async (req, res) => {
    try {
        await poolLogsConnect;
        await poolLogs.request()
            .input('code', sql.VarChar, req.body.barcode)
            .input('status', sql.VarChar, req.body.status)
            .input('msg', sql.VarChar, req.body.message)
            .query('INSERT INTO ScanLogs (BarcodeScanned, ScanStatus, Message, ScanTime) VALUES (@code, @status, @msg, GETDATE())');
        
        res.json({ success: true });
    } catch (err) {
        console.error("Log Insert Error:", err);
        res.status(500).json({ success: false }); 
    }
});

// 4. Get Logs
app.get('/api/logs', async (req, res) => {
    try {
        await poolLogsConnect;
        const result = await poolLogs.request().query('SELECT TOP 100 * FROM ScanLogs ORDER BY ScanTime DESC');
        res.json(result.recordset);
    } catch (err) { 
        console.error("Fetch Logs Error:", err);
        res.json([]); 
    }
});

// 5. Delete Logs
app.delete('/api/logs', async (req, res) => {
    try {
        await poolLogsConnect;
        await poolLogs.request().query('TRUNCATE TABLE ScanLogs'); 
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));