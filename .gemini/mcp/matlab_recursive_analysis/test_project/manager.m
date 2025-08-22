% 管理器脚本 - 包含多层调用关系
function display_manager(value)
    fprintf('Display Manager: %f\n', value);
    show_detailed_info(value);
    format_output(value);
end

function plot_manager(data)
    figure;
    plot(data);
    title('Data Plot');
    xlabel('Index');
    ylabel('Value');
    grid on;
    save_plot();
end

function show_detailed_info(value)
    if value > 0
        fprintf('Positive value: %f\n', value);
    else
        fprintf('Non-positive value: %f\n', value);
    end
    log_info('Detailed info displayed');
end

function format_output(value)
    fprintf('Formatted output: %.2f\n', value);
end

function save_plot()
    print('plot.png', '-dpng');
    fprintf('Plot saved as plot.png\n');
end

function log_info(message)
    fprintf('[INFO] %s\n', message);
end 