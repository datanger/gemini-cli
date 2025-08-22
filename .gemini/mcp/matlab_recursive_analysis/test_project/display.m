% 显示函数脚本
function display_result(value)
    fprintf('Result: %f\n', value);
    show_details(value);
end

function show_details(value)
    if value > 0
        fprintf('Positive value\n');
    else
        fprintf('Non-positive value\n');
    end
end

function plot_data(data)
    figure;
    plot(data);
    title('Data Plot');
    xlabel('Index');
    ylabel('Value');
    grid on;
end 