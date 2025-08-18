const whois = require('whois');
const util = require('util');

const lookup = util.promisify(whois.lookup);

/**
 * WHOIS가 반환하는 원본 텍스트 데이터에서 필요한 정보(만료일, 등록일, 등록기관)를 추출하는 함수입니다.
 * 정규 표현식을 사용하여 .kr 도메인의 복잡한 형식을 포함한 모든 케이스를 처리하도록 파싱 로직을 대폭 개선했습니다.
 * @param {string} rawData - WHOIS 조회로 얻은 원본 텍스트 데이터
 * @returns {{expiry_date: string|null, creation_date: string|null, registrar: string|null}} - 추출된 정보 객체
 */
function parseWhoisData(rawData) {
    let expiryDate = null;
    let creationDate = null;
    let registrar = null;

    // 정규 표현식을 사용하여 키워드 뒤의 값을 추출하는 헬퍼 함수
    // i 플래그: 대소문자 무시, \s*: 공백이 0개 이상 있음을 의미
    const getValue = (regex) => {
        const match = rawData.match(regex);
        // match가 있고, 캡처 그룹(괄호 안의 내용)이 존재하면 해당 값을 반환
        return match && match[1] ? match[1].trim() : null;
    };

    // 여러 종류의 키워드를 배열로 관리하여 하나씩 시도
    const registrarKeywords = [/Registrar:\s*(.*)/i, /Registrar Name:\s*(.*)/i, /등록대행자\s*:\s*(.*)/i];
    const expiryKeywords = [/Registry Expiry Date:\s*(.*)/i, /Registrar Registration Expiration Date:\s*(.*)/i, /Expiry Date:\s*(.*)/i, /expires:\s*(.*)/i, /만료일\s*:\s*(.*)/i];
    const creationKeywords = [/Creation Date:\s*(.*)/i, /Registration Date:\s*(.*)/i, /created:\s*(.*)/i, /등록일\s*:\s*(.*)/i];

    for (const regex of registrarKeywords) {
        registrar = getValue(regex);
        if (registrar) break;
    }
    for (const regex of expiryKeywords) {
        expiryDate = getValue(regex);
        if (expiryDate) break;
    }
    for (const regex of creationKeywords) {
        creationDate = getValue(regex);
        if (creationDate) break;
    }
    
    return {
        expiry_date: expiryDate,
        creation_date: creationDate,
        registrar: registrar,
    };
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const domain = event.queryStringParameters?.domain;

    if (!domain) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '도메인 파라미터가 필요합니다.' })
        };
    }

    try {
        const rawData = await lookup(domain, { follow: 2, verbose: true });
        
        const rawText = Array.isArray(rawData) ? rawData.map(d => d.data).join('\n') : rawData;

        if (!rawText) {
            throw new Error('도메인 정보를 찾을 수 없습니다. (존재하지 않는 도메인일 수 있습니다)');
        }

        const parsedData = parseWhoisData(rawText);

        if (!parsedData.expiry_date) {
             throw new Error('도메인 만료일 정보를 파싱할 수 없습니다. 지원되지 않는 도메인 형식이거나 정보 조회가 제한된 도메인일 수 있습니다.');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                domain: domain,
                ...parsedData,
                status: 'registered'
            })
        };

    } catch (error) {
        console.error('WHOIS Lookup Error:', error);
        
        let errorMessage = '도메인 정보를 조회하는 중 오류가 발생했습니다.';
        if (error.message && (error.message.includes('No match for domain') || error.message.includes('Domain not found'))) {
            errorMessage = '해당 도메인을 찾을 수 없습니다. 오타가 없는지 확인해주세요.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
