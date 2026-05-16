const fs = require('fs');
const code = fs.readFileSync('./parser.js', 'utf8');
const context = {};
const vm = require('vm');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const dom = new JSDOM('<!DOCTYPE html><body></body>');
global.document = dom.window.document;
global.window = dom.window;
global.DOMParser = dom.window.DOMParser;
global.NodeFilter = dom.window.NodeFilter;
global.Node = dom.window.Node;
eval(code); // defines SavemockParser

const html = `
<div class="singlequestion" style="height: 513px;">
    <div id="alert-73" class="qos-col">
        <div class="attemptalert">
            Attempt again or <a href="#soltxt-73" id="vsbt-73" type="button" class="btn-primary btn-viewsol" onclick="viewsolution(73, 1);">View Solution</a>
        </div>
    </div>
            
    <div id="qblock-73" class="qblock qos-col"><span class="eqt"><p>( 5 ( 3 ( ( 3  -  5 ) 2 + 2 ) + 4 )  -  10 ) x 1/2 = ?</p></span><span class="hqt" style="display:none"><p>( 5 ( 3 ( ( 3 - 5 ) 2 + 2 ) + 4 ) - 10 ) x 1/2 = ?</p></span></div>
    <div class="oblock qos-col">
        <div class="qoptions">
            <div id="opt-73-0" class="opt cursorst" onclick="attemptAgain(1, 0, 73)">
                <div class="left">A</div>
                <div class="right"><div class="rightopt"><span class="eqt">12</span><span class="hqt" style="display:none">12</span></div></div>
            </div>
            
            <div id="opt-73-1" class="opt cursorst" onclick="attemptAgain(1, 1, 73)">
                <div class="left">B</div>
                <div class="right"><div class="rightopt"><span class="eqt">-10</span><span class="hqt" style="display:none">-10</span></div></div>
            </div>
            
            <div id="opt-73-2" class="opt cursorst" onclick="attemptAgain(1, 2, 73)">
                <div class="left">C</div>
                <div class="right"><div class="rightopt"><span class="eqt">9</span><span class="hqt" style="display:none">9</span></div></div>
            </div>
            
            <div id="opt-73-3" class="opt cursorst" onclick="attemptAgain(1, 3, 73)">
                <div class="left">D</div>
                <div class="right"><div class="rightopt"><span class="eqt">11</span><span class="hqt" style="display:none">11</span></div></div>
            </div>
            
            
        </div>
    </div>
    <div class="toppervsyou qos-col">
        <div class="toppervsyou-inner">
        <h3>Topper vs You</h3>
        <table>
            <thead>
                <tr>
                    <th></th>
                    <th>status</th>
                    <th>Time Taken</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>You</td>
                    <td class="unat"><span></span>Unattempted</td>
                    <td>147</td>
                </tr>
                <tr>
                    <td>Topper</td>
                    <td class="correct"><span></span>Correct</td>
                    <td>34</td>
                </tr>
                
            </tbody>
        </table>
        </div>
    </div>
    <div id="sol-73" class="sblock qos-col hide-class">
        <div class="sblock-inner">
            <h3>Solution</h3>
            <div id="soltxt-73" class="solutiontxt"><p>( 5 ( 3 ( ( 3  -  5 ) 2 + 2 ) + 4 )  -  10 ) ½</p><p>= ( 5 ( 3 ( -4 + 2 ) + 4 )  -  10 ) ½</p><p>= (5 (-6 + 4)  -  10) ½</p><p>= (-10  -  10) ½</p><p>= (-20) ½</p><p>= -10</p></div>
        </div>
    </div>
</div>
`;

const result = SavemockParser.parseQuestionsFromHtml(html);
console.log(result[0].questionHtml);
