import path from 'path'
import fs from 'fs'
import readline from 'readline'

interface IColRef {
  table: string,
  col: string,
}

interface ITableColumn {
  name: string,
  isPk?: boolean,
  'NOT NULL'?: boolean,
  ref?: IColRef,
  type?: string,
  AUTO_INCREMENT?: boolean
}

interface ITableObject{
  tableName: string,
  pkList: string[],
  columns: {
    [key: string]: ITableColumn,
  }
}

interface IUML {
  [key: string]: ITableObject,
}

function getType(ref: IColRef, uml: IUML) {
  return uml[ref.table].columns[ref.col].type
}

export default function parseFile(filePath: string) {
  return new Promise<IUML>(
    (res, rej) => {
      let isUML = false
      let isTable = false
      let currentTableObject: ITableObject
      let currentColumn: ITableColumn
      let JSONUML: IUML = {}
      const fullPath = path.join(__dirname, filePath)

      const rl = readline.createInterface({
        input: fs.createReadStream(fullPath)
      })

      rl.on('line', (input) => {
        if (!isUML && input.startsWith('@startuml')) {
          isUML = true
          return
        }
        if (isUML) {
          input = input.trim()
          if (!isTable && input.startsWith('class')) {
            isTable = true
            const tableName = input.split(' ')[1]
            currentTableObject = {
              pkList: [],
              tableName,
              columns: {},
            }
            JSONUML[tableName] = currentTableObject
            return
          }
          if (isTable && input !== '}') {
            let tableColData = input.split(' ')
            tableColData.forEach(
              (colData, index) => {
                let colName = colData
                if (index === 0) {
                  if (colData[0] === '#' || colData[0] === '+') {
                    colName = colData.substr(1)
                    currentTableObject.pkList.push(colName)
                    currentColumn = {
                      name: colName,
                      isPk: true
                    }
                    
                  } else if (colData === '..') {
                    return
                  } else {
                    if (colData[0] === '-') {
                      colName = colData.substr(1)
                    }
                    currentColumn = {
                      name: colName,
                      isPk: false
                    }
                  }
                  currentTableObject.columns[colName] = currentColumn
                } else if (colData === 'NN') {
                  currentColumn['NOT NULL'] = true
                } else if (colData === 'AUTO_INCREMENT') {
                  currentColumn.AUTO_INCREMENT = true
                } else if (colData.startsWith('REF(')) {
                  const ref = colData.slice(4, -1).split('.')
                  currentColumn.ref = {
                    table: ref[0].charAt(0).toUpperCase() + ref[0].slice(1),
                    col: ref[1],
                  }
                } else {
                  currentColumn.type = colData
                }
              }
            )
          } else if (isTable && input === '}') {
            isTable = false
          }
        }
      })

      rl.on('close', () => {
        res(JSONUML)
      })
    }
  ).then(
    (uml) => {
      let createStatement = ''
      const tables = Object.keys(uml)
      tables.forEach(
        (tableName) => {
          const foreignKeys: string[] = []
          const columnLines: string[] = []
          createStatement += `\nCREATE TABLE IF NOT EXISTS ${tableName} (`
          const columns = uml[tableName].columns
          const columnKeys = Object.keys(uml[tableName].columns)
          columnKeys.forEach(
            (columnName) => {
              const columnData = columns[columnName]
              if (columnData.ref) {
                columnData.type = getType(columnData.ref, uml)
                foreignKeys.push(`FOREIGN KEY (${columnData.name}) REFERENCES ${columnData.ref.table}(${columnData.ref.col})`)
              }
              columnLines.push(`${columnName} ${columnData.type}${columnData.AUTO_INCREMENT && ' AUTO_INCREMENT' || ''}${columnData.isPk && ' PRIMARY KEY' || ''}`)
            }
          )
          
          createStatement += `\n${columnLines.join(',\n')}`

          if (foreignKeys.length) {
            createStatement += `,\n${foreignKeys.join(',\n')}`
          }
          createStatement += `\n)  ENGINE=INNODB;\n`
        }
      )
      return createStatement
    }
  )
}