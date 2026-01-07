-- Create Database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'ZebraInventoryDB')
BEGIN
    CREATE DATABASE ZebraInventoryDB;
END
GO

USE ZebraInventoryDB;
GO

-- Create Products Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE Products (
        ProductID INT IDENTITY(1,1) PRIMARY KEY,
        Barcode VARCHAR(50) NOT NULL UNIQUE,
        Name VARCHAR(100) NOT NULL,
        SKU VARCHAR(50),
        Price DECIMAL(10, 2)
    );
END

-- Create ScanLogs Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ScanLogs')
BEGIN
    CREATE TABLE ScanLogs (
        LogID INT IDENTITY(1,1) PRIMARY KEY,
        BarcodeScanned VARCHAR(50),
        ScanStatus VARCHAR(20),
        Message VARCHAR(255),
        ScanTime DATETIME DEFAULT GETDATE()
    );
END
GO

-- Seed Test Data
TRUNCATE TABLE Products;
INSERT INTO Products (Barcode, Name, SKU, Price) VALUES
('1001', 'Zebra TC53e Scanner', 'ZEB-001', 500.00),
('1002', 'Wireless Access Point', 'WAP-X99', 120.50),
('1003', 'Industrial Label Printer', 'PRT-400', 850.00),
('1004', 'USB-C Cable (3ft)', 'CBL-003', 15.99);
GO